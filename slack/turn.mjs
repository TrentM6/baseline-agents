// turn.mjs: the Slack adapter's turn handler. Turns one @mention or DM into
// one agent turn through the core runner, and posts the answer in the thread.
//
// Everything that makes the agent itself (persona, memory, tools, model)
// comes from core/. This file adds only what Slack needs: thread memory
// (`--resume` per thread), per-thread serialization, a global concurrency
// cap, the thread history as context, Slack etiquette, silence handling, and
// an honest error reply instead of silence when anything fails.
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import path from "node:path";
import { ROOT, roster, envValue, envSlug } from "../core/config.mjs";
import { buildSystem, buildAllowedTools, loadMemory, GROUNDING_RULES } from "../core/prompt.mjs";
import { runClaude } from "../core/run.mjs";
import { postMessage, addReaction, fetchReplies } from "./slack-api.mjs";
import { toSlackMessage } from "./format-blocks.mjs";

const LOG_DIR = path.join(ROOT, "logs", "slack-agent");
const SESS_FILE = path.join(LOG_DIR, "sessions.json");

// SLACK_AGENT_DRY_RUN=1 → never spawn claude or touch Slack; log the intent so
// the offline selftest can assert "the runner would have spawned".
const DRY_RUN = process.env.SLACK_AGENT_DRY_RUN === "1";
const DRYRUN_LOG = process.env.SLACK_DRYRUN_LOG || path.join(LOG_DIR, "dryrun.jsonl");

// Optional per-agent avatar: <AVATAR_BASE_URL>/<slug>.png. Needs chat:write.customize.
const AVATAR_BASE = (process.env.AVATAR_BASE_URL || "").replace(/\/+$/, "");
const agentIconUrl = (slug) => (AVATAR_BASE ? `${AVATAR_BASE}/${slug}.png` : undefined);

const MAX_INFLIGHT = Number(process.env.SLACK_MAX_INFLIGHT || 2); // global cap across all agents/threads
const PROGRESS_MIN_GAP_MS = 20_000; // at most one progress line per 20s per run
const CHANNEL_MIN_GAP_MS = 1000;    // at most one message per second per channel

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.error(`[slack ${new Date().toISOString()}] ${m}`);

/** Slack credentials for one agent, read fresh. Null if either is missing. */
export function slackSecrets(slug) {
  const k = envSlug(slug);
  const signing = envValue(`SLACK_${k}_SIGNING_SECRET`);
  const bot = envValue(`SLACK_${k}_BOT_TOKEN`);
  return signing && bot ? { SLACK_SIGNING_SECRET: signing, SLACK_BOT_TOKEN: bot } : null;
}

// --- per-thread session memory (persisted so restarts keep thread memory) -----
let sessions = loadSessions();
function loadSessions() { try { return JSON.parse(readFileSync(SESS_FILE, "utf8")); } catch { return {}; } }
function saveSessions() {
  try { mkdirSync(LOG_DIR, { recursive: true }); writeFileSync(SESS_FILE, JSON.stringify(sessions, null, 2)); } catch {}
}

// --- global concurrency semaphore --------------------------------------------
let inFlight = 0;
const waiters = [];
function acquire() {
  if (inFlight < MAX_INFLIGHT) { inFlight++; return Promise.resolve(); }
  return new Promise((res) => waiters.push(res));
}
function release() {
  inFlight--;
  const next = waiters.shift();
  if (next) { inFlight++; next(); }
}

const chains = new Map();      // threadKey -> Promise: one turn at a time per thread
const activeTurns = new Map(); // turns mid-flight, announced on shutdown

// --- at most one message per second per channel --------------------------------
const channelPost = new Map();
function ratedPost(token, channel, args) {
  const st = channelPost.get(channel) || { chain: Promise.resolve(), last: 0 };
  st.chain = st.chain.then(async () => {
    const wait = CHANNEL_MIN_GAP_MS - (Date.now() - st.last);
    if (wait > 0) await sleep(wait);
    st.last = Date.now();
    return postMessage(token, { channel, ...args });
  });
  channelPost.set(channel, st);
  return st.chain;
}

const cleanText = (text) => String(text || "").replace(/^\s*(?:<@[^>]+>\s*)+/, "").trim();

// --- Slack etiquette and silence --------------------------------------------------
// The exact sentinel a turn outputs to post NOTHING. Silence has to be a real
// capability: two agents each politely announcing "going silent" AT each
// other keep a loop alive, because every announcement is itself a mention.
export const NO_REPLY = "NO_REPLY";

// Silence is offered ONLY when a BOT mentioned this agent deep inside a thread
// (the echo-loop case). A human or top-level mention always gets a reply.
const SILENCE_CLAUSE =
  `If the message genuinely needs NOTHING from you (a pure acknowledgment, a repeated message you've already answered, an exchange between others that mentions you only in passing), reply with exactly ${NO_REPLY} and nothing else. The runner then posts nothing. Posting "staying silent" IS a reply and re-triggers whoever you mention. Never output ${NO_REPLY} when a human asked you a direct question. `;
const MUST_REPLY_CLAUSE =
  `You were directly addressed and a reply is REQUIRED. Do NOT output ${NO_REPLY}: here it would post as a literal word. Even if there is little to add, post one or two honest lines. If the request is outside your domain, still reply and hand it off with a real mention. `;

export function slackRules(canBeSilent) {
  return (
    "You are replying inside Slack. Your PERSONA above defines your voice and governs EVERY reply, overriding the default AI-assistant register. No throat-clearing openers, no narrating your process, no recap closer, no reflexive hedging. For a conversational answer: be brief (usually two to four sentences), make one sharp point with one concrete example, and leave the obvious unsaid. No markdown headers and no sign-off on a normal reply. " +
    (canBeSilent ? SILENCE_CLAUSE : MUST_REPLY_CLAUSE) +
    "For a REPORT-shaped answer (several findings, a multi-part status) use real markdown structure: `#`/`##` headings, **bold** labels, `-` lists. It renders as a formatted Slack message. Use emoji only where it adds signal. " +
    "You run HEADLESS: no one can approve a permission prompt. If a tool is denied, note the gap in one line and continue with what you can do; never retry a denied tool in another form."
  );
}

/** Strip a standalone or trailing NO_REPLY so the literal word can never post. */
const stripDeco = (s) => s.trim().replace(/^[*_`\s]+|[*_`\s]+$/g, "");
export function stripSentinel(t) {
  const lines = String(t).trim().split("\n").map((l) => l.trim());
  while (lines.length && stripDeco(lines[lines.length - 1]) === NO_REPLY) lines.pop();
  const kept = lines.join("\n").trim();
  return stripDeco(kept) === NO_REPLY ? "" : kept;
}

// --- thread context: every turn sees the conversation, not one message --------
// `--resume` gives the SAME agent its own memory of a thread but shows nothing
// said by anyone else. Best-effort: if the fetch fails, the turn runs on the
// triggering message alone.
const THREAD_CTX_MESSAGES = 12;
const THREAD_CTX_MSG_CAP = 600;
function labelFor(msg) {
  if (msg.bot_profile?.name) return msg.bot_profile.name;
  if (msg.user) return roster().find((a) => a.slackUserId === msg.user)?.name || `<@${msg.user}>`;
  return "unknown";
}
async function threadContext(token, { channel, threadTs, triggerTs }) {
  try {
    const r = await fetchReplies(token, { channel, ts: threadTs, limit: 40 });
    if (!r.ok || !Array.isArray(r.messages)) return "";
    const prior = r.messages.filter((m) => m.ts !== triggerTs && (m.text || "").trim());
    if (!prior.length) return "";
    const lines = prior.slice(-THREAD_CTX_MESSAGES).map((m) => {
      let t = m.text.replace(/\s+/g, " ").trim();
      if (t.length > THREAD_CTX_MSG_CAP) t = t.slice(0, THREAD_CTX_MSG_CAP) + " …[truncated]";
      return `${labelFor(m)}: ${t}`;
    });
    return (
      "=== THREAD SO FAR (oldest→newest; the message you are answering came AFTER all of these) ===\n" +
      lines.join("\n") +
      "\n=== END THREAD SO FAR ===\n\n" +
      `Read the thread before answering: don't re-ask for anything already stated above, don't repeat a point already made, and if the new message just repeats something you already answered, that's an echo; reply ${NO_REPLY}.\n\n`
    );
  } catch {
    return "";
  }
}

export function buildSlackSystem(agent, canBeSilent) {
  return buildSystem(agent, { surfaceRules: slackRules(canBeSilent), mentions: true });
}

// --- one full turn: ack → run → progress → final (or honest error) -----------
async function runTurn(agent, ev) {
  const channel = ev.channel;
  const threadTs = ev.thread_ts || ev.ts;
  const threadKey = `${channel}:${threadTs}`;
  const user = ev.user || null; // bot-authored triggers have bot_id, not user
  const mentionPrefix = user ? `<@${user}> ` : "";
  const text = cleanText(ev.text) || "(you were mentioned with no text; greet them and ask what they need)";
  const token = agent.secrets.SLACK_BOT_TOKEN;
  const icon = agentIconUrl(agent.slug);
  const post = (args) => ratedPost(token, channel, icon ? { ...args, icon_url: icon } : args);

  if (DRY_RUN) {
    try { mkdirSync(path.dirname(DRYRUN_LOG), { recursive: true }); } catch {}
    appendFileSync(DRYRUN_LOG, JSON.stringify({ ts: new Date().toISOString(), slug: agent.slug, threadKey, user, text: text.slice(0, 200), allowedTools: buildAllowedTools(agent), memoryLoaded: loadMemory(agent).loaded }) + "\n");
    log(`DRY RUN: would run ${agent.slug} in ${threadKey}: "${text.slice(0, 60)}"`);
    return;
  }

  await acquire();
  activeTurns.set(threadKey, { agent, token, channel, threadTs });
  try {
    // The 👀 reaction is the only immediate ack: one mention = one message,
    // the answer. Progress lines start only once a run has gone on a while.
    try { await addReaction(token, { channel, timestamp: ev.ts, name: "eyes" }); } catch {}

    const fromBot = Boolean(ev.bot_id) || ev.subtype === "bot_message";
    const isTopLevel = !ev.thread_ts || ev.thread_ts === ev.ts;
    const canBeSilent = fromBot && !isTopLevel;
    const system = buildSlackSystem(agent, canBeSilent);
    const startedAt = Date.now();
    let lastPhaseAt = 0;
    let lastPhase = "";
    const onPhase = (phase) => {
      const now = Date.now();
      if (now - startedAt < PROGRESS_MIN_GAP_MS) return;
      if (phase === lastPhase || now - lastPhaseAt < PROGRESS_MIN_GAP_MS) return;
      lastPhase = phase; lastPhaseAt = now;
      post({ text: `…${phase}`, thread_ts: threadTs }).catch(() => {});
    };

    const ctx = await threadContext(token, { channel, threadTs, triggerTs: ev.ts });
    const prompt = ctx ? `${ctx}The new message addressed to you:\n${text}` : text;
    const run = (p, resumeId) => runClaude({ agent, prompt: p, system, resumeId, onPhase, surface: "slack" });

    log(`turn ${agent.slug} ${threadKey} (resume=${sessions[threadKey] ? "y" : "n"}, ctx=${ctx ? "y" : "n"})`);
    let r = await run(prompt, sessions[threadKey] || null);
    // A stale --resume id fails the run; retry once fresh so a rotated session
    // can't wedge a thread permanently.
    if (!r.ok && sessions[threadKey]) {
      log(`resume failed for ${threadKey} (${r.reason}); retrying without --resume`);
      delete sessions[threadKey]; saveSessions();
      r = await run(prompt, null);
    }
    if (r.sessionId) { sessions[threadKey] = r.sessionId; saveSessions(); }

    if (!r.ok) {
      log(`turn FAILED ${agent.slug} ${threadKey}: ${r.reason}`);
      await post({ text: `${mentionPrefix}hit an error on that one; details are in my logs. Mind trying again?`, thread_ts: threadTs });
      return;
    }

    let replyText = stripSentinel(r.text);
    if (replyText === "" && canBeSilent) {
      log(`no-reply ${agent.slug} ${threadKey} (agent chose silence)`);
      return;
    }
    if (replyText === "") {
      // A reply was required but the agent emitted only the sentinel. Ask once
      // more, explicitly; then fall back to an honest minimal line.
      log(`forced-reply ${agent.slug} ${threadKey}: ${NO_REPLY} on a required reply, retrying`);
      const f = await run(prompt + `\n\n[SYSTEM: A reply is REQUIRED; you were directly addressed. Reply now with one or two honest lines. Do NOT output ${NO_REPLY}.]`, sessions[threadKey] || null);
      if (f.sessionId) { sessions[threadKey] = f.sessionId; saveSessions(); }
      if (f.ok) replyText = stripSentinel(f.text);
      if (!replyText) replyText = "Nothing new from me on this one.";
    }
    // Mention on its own line when the reply opens with a heading, so it doesn't
    // break the "# " match in the Block Kit conversion.
    const body = /^#{1,3} /.test(replyText) ? `${mentionPrefix}\n\n${replyText}` : `${mentionPrefix}${replyText}`;
    const { text: slackText, blocks } = toSlackMessage(body);
    await post({ text: slackText, blocks, thread_ts: threadTs });
    log(`replied ${agent.slug} ${threadKey}`);
  } catch (err) {
    log(`turn EXCEPTION ${agent.slug} ${threadKey}: ${err.message}`);
    try { await post({ text: `${mentionPrefix}hit an error on that one; details are in my logs. Mind trying again?`, thread_ts: threadTs }); } catch {}
  } finally {
    activeTurns.delete(threadKey);
    release();
  }
}

/** Called by receiver.mjs after it has ack'd Slack. Serializes per thread;
 * never throws (failures become a threaded error reply). */
export function handleEvent(agent, ev) {
  const threadKey = `${ev.channel}:${ev.thread_ts || ev.ts}`;
  const prev = chains.get(threadKey) || Promise.resolve();
  const job = prev.then(() => runTurn(agent, ev)).catch((e) => log(`chain error ${threadKey}: ${e.message}`));
  chains.set(threadKey, job.finally(() => { if (chains.get(threadKey) === job) chains.delete(threadKey); }));
  return job;
}

// On shutdown, post one honest notice per in-flight turn before exiting, so a
// restart reads as "got interrupted, retry" instead of silence.
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  const turns = [...activeTurns.values()];
  activeTurns.clear();
  if (turns.length) log(`${signal}: announcing ${turns.length} interrupted turn(s) before exit`);
  await Promise.all(turns.map((t) => {
    const icon = agentIconUrl(t.agent.slug);
    return postMessage(t.token, {
      channel: t.channel,
      thread_ts: t.threadTs,
      text: `${t.agent.name} got interrupted by a restart mid-turn. Mind sending that again?`,
      ...(icon ? { icon_url: icon } : {}),
    }).catch(() => {});
  }));
  process.exit(0);
}
export function installShutdownHandlers() {
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

export { GROUNDING_RULES };
