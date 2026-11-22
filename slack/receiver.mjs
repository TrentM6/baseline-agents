// receiver.mjs: the Slack adapter's HTTP endpoint, serving every agent's Slack
// Events API. Optional: agents work locally without it.
//
// One process, one port (default 127.0.0.1:8790). Put a TLS-terminating proxy
// in front of it (see infra/Caddyfile.example) or a tunnel for local testing.
// No npm deps: node:http, node:crypto, global fetch only.
//
// The two rules Slack imposes, and how we meet them:
//  1. ACK FAST. Slack retries any ack slower than 3s and disables endpoints
//     that keep failing. We verify and ack 200 within ~1s and run the turn
//     after res.end(). Retries are deduped by event_id, so a slow turn never
//     produces a second reply.
//  2. VERIFY EVERY REQUEST. HMAC-SHA256 v0 signature with THAT agent's signing
//     secret, and a 5-minute replay window on the timestamp.
//
// Route: POST /slack/events/<slug>  (slug = a key in agents/agents.json).
import http from "node:http";
import crypto from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { ROOT, ENV_FILE, resolveAgent as resolveCore, loadSharedEnv, warnIfNoApiKey } from "../core/config.mjs";
import { handleEvent, installShutdownHandlers, slackSecrets } from "./turn.mjs";

// The core agent plus its live Slack credentials (re-read on every event).
function resolveAgent(slug) {
  const agent = resolveCore(slug);
  return agent ? { ...agent, secrets: slackSecrets(slug) } : null;
}

const PORT = Number(process.env.SLACK_RECEIVER_PORT || 8790);
const HOST = process.env.SLACK_RECEIVER_HOST || "127.0.0.1";
const MAX_BODY = 1024 * 1024; // Slack event payloads are small
const REPLAY_WINDOW_S = 60 * 5;
const log = (m) => console.error(`[slack-receiver ${new Date().toISOString()}] ${m}`);

// --- event_id dedupe (in-memory LRU) -----------------------------------------
const seen = new Map();
const SEEN_MAX = 5000;
function alreadySeen(id) {
  if (!id) return false;
  if (seen.has(id)) return true;
  seen.set(id, Date.now());
  if (seen.size > SEEN_MAX) seen.delete(seen.keys().next().value);
  return false;
}

// --- Slack request signature (v0 = HMAC-SHA256 of `v0:ts:rawbody`) ------------
function verifySignature(secret, timestamp, rawBody, signature) {
  if (!signature || !timestamp) return false;
  const t = Number(timestamp);
  if (!Number.isFinite(t) || Math.abs(Date.now() / 1000 - t) > REPLAY_WINDOW_S) return false;
  const mac = "v0=" + crypto.createHmac("sha256", secret).update(`v0:${timestamp}:${rawBody}`).digest("hex");
  const a = Buffer.from(mac);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const sendJson = (res, code, obj) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
const sendText = (res, code, msg) => { res.writeHead(code, { "Content-Type": "text/plain" }); res.end(msg || ""); };

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    let over = false;
    req.on("data", (c) => { raw += c; if (raw.length > MAX_BODY) { over = true; req.destroy(); } });
    req.on("end", () => (over ? reject(new Error("body too large")) : resolve(raw)));
    req.on("error", reject);
  });
}

// Only these event shapes get a reply: an @mention, or a DM from a human.
// Everything else (edits, joins, the bot's own posts) is ack'd and ignored.
//
// Bot-to-bot mentions are allowed, so agents can delegate to each other, but
// capped per thread. Without a cap, two agents that politely mention each
// other back and forth loop forever. Real delegation needs at most:
// delegate (1) → report back (2) → close out (3). The cap of 4 leaves one
// spare hop. Self-mentions can't loop (Slack doesn't deliver an app_mention to
// the app that wrote the message) and DMs from bots are always ignored.
export const BOT_HOP_CAP = Number(process.env.SLACK_BOT_HOP_CAP || 4);
const botHops = new Map();
function replyableEvent(ev) {
  if (!ev) return false;
  const fromBot = Boolean(ev.bot_id) || ev.subtype === "bot_message";
  if (ev.type === "app_mention") {
    if (!fromBot) return true;
    const isTopLevel = !ev.thread_ts || ev.thread_ts === ev.ts;
    if (isTopLevel) return true;
    const key = `${ev.channel}:${ev.thread_ts || ev.ts}`;
    const hops = (botHops.get(key) || 0) + 1;
    botHops.set(key, hops);
    return hops <= BOT_HOP_CAP;
  }
  if (ev.type === "message" && ev.channel_type === "im" && !ev.subtype && !ev.bot_id) return true;
  return false;
}

async function handle(req, res) {
  if (req.method === "GET" && req.url === "/healthz") return sendText(res, 200, "ok");
  if (req.method !== "POST") return sendText(res, 405, "method not allowed");
  const m = /^\/slack\/events\/([a-z0-9-]+)\/?$/.exec(req.url || "");
  if (!m) return sendText(res, 404, "not found");
  const slug = m[1];

  let rawBody;
  try { rawBody = await readBody(req); } catch { return sendText(res, 413, "payload too large"); }

  // Kill switch: ack everything, process nothing.
  if (process.env.SLACK_AGENTS_DISABLED === "1") return sendText(res, 200, "");

  const agent = resolveAgent(slug);
  if (!agent) return sendText(res, 404, "unknown agent");
  if (!agent.secrets) {
    // No signing secret yet, so nothing can be verified or processed. One
    // exception: echo url_verification challenges. Slack pings the Request URL
    // the moment you create an app from a manifest, BEFORE you have copied the
    // signing secret into .env, and a failed ping blocks app creation. Echoing
    // a string takes no action and spawns nothing; real events still 503.
    let b; try { b = JSON.parse(rawBody); } catch { b = null; }
    if (b?.type === "url_verification") {
      log(`${slug}: url_verification echoed unverified (no Slack credentials in .env yet)`);
      return sendJson(res, 200, { challenge: b.challenge });
    }
    log(`${slug}: Slack credentials missing → 503`);
    return sendText(res, 503, "agent not configured");
  }

  // Verify BEFORE trusting any field of the body.
  const ok = verifySignature(
    agent.secrets.SLACK_SIGNING_SECRET,
    req.headers["x-slack-request-timestamp"],
    rawBody,
    req.headers["x-slack-signature"],
  );
  if (!ok) { log(`${slug}: bad signature or stale timestamp → 401`); return sendText(res, 401, "bad signature"); }

  let body; try { body = JSON.parse(rawBody); } catch { return sendText(res, 400, "bad json"); }

  if (body.type === "url_verification") return sendJson(res, 200, { challenge: body.challenge });

  // ACK NOW, process async. Retries carry the same event_id, so dedupe covers them.
  sendText(res, 200, "");
  try {
    if (body.type !== "event_callback") return;
    if (alreadySeen(body.event_id)) { log(`${slug}: duplicate ${body.event_id} (retry=${req.headers["x-slack-retry-num"] || "-"}) skipped`); return; }
    const ev = body.event;
    if (!replyableEvent(ev)) return;
    Promise.resolve(handleEvent(agent, ev)).catch((e) => log(`${slug}: handleEvent error: ${e.message}`));
  } catch (e) {
    log(`${slug}: post-ack error: ${e.message}`);
  }
}

/** Start the server. Exported so the offline selftest can boot it on a test port. */
export function start(port = PORT) {
  loadSharedEnv();
  if (!process.env.SLACK_AGENT_DRY_RUN) warnIfNoApiKey("slack-receiver");
  installShutdownHandlers();
  try { mkdirSync(path.join(ROOT, "logs/slack-agent"), { recursive: true }); } catch {}
  const server = http.createServer((req, res) => { handle(req, res).catch((e) => { log(`unhandled: ${e.message}`); try { sendText(res, 500, "error"); } catch {} }); });
  return new Promise((resolve) => server.listen(port, HOST, () => { log(`listening on ${HOST}:${port}: env file ${ENV_FILE}`); resolve(server); }));
}

if (import.meta.url === `file://${process.argv[1]}`) start();
