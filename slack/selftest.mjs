// selftest.mjs: offline check of the Slack adapter (receiver + turn handler), with NO Slack
// and NO Claude. Boots the receiver on a test port against a temp .env and a
// fixture registry, with SLACK_AGENT_DRY_RUN=1 so the runner records what it
// would have spawned instead of spawning it. Exits nonzero on any failure.
//
//   npm run selftest
import crypto from "node:crypto";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = 8799;
const SECRET = "dummy_signing_secret_for_selftest";
const BASE_URL = `http://127.0.0.1:${PORT}`;

// Fixture: scout (configured, has memory), builder (configured, work mode,
// no memory), ghost (no Slack credentials → 503).
const tmp = mkdtempSync(path.join(os.tmpdir(), "agents-selftest-"));
writeFileSync(path.join(tmp, ".env"), [
  `SLACK_SCOUT_SIGNING_SECRET=${SECRET}`, "SLACK_SCOUT_BOT_TOKEN=xoxb-dummy",
  `SLACK_BUILDER_SIGNING_SECRET=${SECRET}`, "SLACK_BUILDER_BOT_TOKEN=xoxb-dummy",
].join("\n") + "\n", { mode: 0o600 });
writeFileSync(path.join(tmp, "agents.json"), JSON.stringify({
  scout: { name: "Scout", persona: "personas/scout.md", description: "fixture" },
  builder: {
    name: "Builder", persona: "personas/scout.md", description: "fixture",
    workRepos: { site: { path: "workspaces/site", repo: "example-owner/site", autoMerge: true } },
  },
  ghost: { name: "Ghost", persona: "personas/scout.md", description: "fixture" },
}));
const dryLog = path.join(tmp, "dryrun.jsonl");

process.env.AGENTS_ENV_FILE = path.join(tmp, ".env");
process.env.AGENTS_REGISTRY = path.join(tmp, "agents.json");
process.env.SLACK_AGENT_DRY_RUN = "1";
process.env.AGENTS_GATEWAY = "off";
process.env.SLACK_DRYRUN_LOG = dryLog;
process.env.SLACK_RECEIVER_PORT = String(PORT);
for (const k of Object.keys(process.env)) if (/^SLACK_.*_(SIGNING_SECRET|BOT_TOKEN)$/.test(k)) delete process.env[k];
delete process.env.SLACK_AGENTS_DISABLED;

let failures = 0;
const ok = (name) => console.log(`  ok   ${name}`);
const bad = (name, detail) => { failures++; console.error(`  FAIL ${name}${detail ? `: ${detail}` : ""}`); };

const sign = (ts, body) => "v0=" + crypto.createHmac("sha256", SECRET).update(`v0:${ts}:${body}`).digest("hex");
async function post(slug, body, { sig, ts, retry } = {}) {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  ts = ts ?? Math.floor(Date.now() / 1000).toString();
  const headers = { "Content-Type": "application/json", "x-slack-request-timestamp": ts, "x-slack-signature": sig ?? sign(ts, raw) };
  if (retry) headers["x-slack-retry-num"] = String(retry);
  const res = await fetch(`${BASE_URL}/slack/events/${slug}`, { method: "POST", headers, body: raw });
  return { status: res.status, text: await res.text() };
}
const dryRecords = () => { try { return readFileSync(dryLog, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
const dryCount = () => dryRecords().length;
const lastDryFor = (slug) => dryRecords().filter((x) => x.slug === slug).pop() || null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitForDry(target, ms = 2000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (dryCount() >= target) return true; await sleep(50); } return false; }

const mention = (eid, extra = {}) => ({
  type: "event_callback",
  event_id: eid,
  event: { type: "app_mention", channel: "C123", ts: "1700000000.000100", user: "U999", text: "<@BBOT> what plans do we sell?", ...extra },
});
const botMention = (eid, extra) => {
  const m = mention(eid, { bot_id: "B0PEER", ...extra });
  delete m.event.user;
  return m;
};

async function main() {
  const { start, BOT_HOP_CAP } = await import("./receiver.mjs");
  const server = await start(PORT);

  {
    const r = await post("scout", { type: "url_verification", challenge: "chal-abc-123" });
    let j = {}; try { j = JSON.parse(r.text); } catch {}
    if (r.status === 200 && j.challenge === "chal-abc-123") ok("url_verification challenge round-trips");
    else bad("url_verification challenge round-trips", `status=${r.status} body=${r.text}`);
  }

  {
    const before = dryCount();
    const r = await post("scout", mention("Ev-accept-1"));
    if (r.status === 200 && (await waitForDry(before + 1))) ok("signed app_mention accepted, runner would spawn");
    else bad("signed app_mention accepted, runner would spawn", `status=${r.status}`);
  }

  {
    const r = await post("scout", mention("Ev-badsig-1"), { sig: "v0=deadbeef" });
    if (r.status === 401) ok("bad signature rejected 401");
    else bad("bad signature rejected 401", `status=${r.status}`);
  }

  {
    const stale = String(Math.floor(Date.now() / 1000) - 3600);
    const raw = JSON.stringify(mention("Ev-stale-1"));
    const r = await post("scout", raw, { ts: stale, sig: sign(stale, raw) });
    if (r.status === 401) ok("stale timestamp (replay) rejected 401");
    else bad("stale timestamp (replay) rejected 401", `status=${r.status}`);
  }

  {
    const before = dryCount();
    await post("scout", mention("Ev-dupe-1"));
    await waitForDry(before + 1);
    const mid = dryCount();
    await post("scout", mention("Ev-dupe-1"), { retry: 1 });
    await sleep(300);
    if (mid === before + 1 && dryCount() === mid) ok("Slack retry with same event_id deduped");
    else bad("Slack retry with same event_id deduped", `before=${before} mid=${mid} after=${dryCount()}`);
  }

  {
    const r = await post("ghost", mention("Ev-503-1"));
    if (r.status === 503) ok("agent without Slack credentials → 503");
    else bad("agent without Slack credentials → 503", `status=${r.status}`);
  }

  {
    const r = await post("nobody", mention("Ev-404-1"));
    if (r.status === 404) ok("unknown agent → 404");
    else bad("unknown agent → 404", `status=${r.status}`);
  }

  {
    const before = dryCount();
    await post("scout", botMention("Ev-bot-top-1", { ts: "1700000000.000200" }));
    if (await waitForDry(before + 1)) ok("bot-authored top-level mention spawns");
    else bad("bot-authored top-level mention spawns");
  }

  {
    const before = dryCount();
    await post("scout", botMention("Ev-bot-thread-1", { ts: "1700000000.000301", thread_ts: "1700000000.000300" }));
    if (await waitForDry(before + 1)) ok("bot-authored threaded mention spawns (delegation works)");
    else bad("bot-authored threaded mention spawns (delegation works)");
  }

  {
    const threadTs = "1700000000.000400";
    for (let i = 0; i < BOT_HOP_CAP; i++) {
      await post("scout", botMention(`Ev-bot-hop-${i}`, { ts: `1700000000.0005${String(i).padStart(2, "0")}`, thread_ts: threadTs }));
    }
    await sleep(500);
    const settled = dryCount();
    await post("scout", botMention("Ev-bot-hop-over", { ts: "1700000000.000599", thread_ts: threadTs }));
    await sleep(300);
    if (dryCount() === settled) ok(`bot ping-pong cut off past BOT_HOP_CAP (${BOT_HOP_CAP})`);
    else bad("bot ping-pong cut off past BOT_HOP_CAP");
  }

  {
    const before = dryCount();
    await post("builder", mention("Ev-work-1"));
    await waitForDry(before + 1);
    const at = lastDryFor("builder")?.allowedTools || "";
    const good =
      at.includes("Edit(./workspaces/site/**)") &&
      at.includes("Bash(git -C workspaces/site commit:*)") &&
      at.includes("Bash(gh pr merge --repo example-owner/site:*)") &&
      !at.includes("Bash(git:*)") && !at.includes("reset") && !at.includes("clean") && !at.includes("rebase");
    if (good) ok("work-mode agent: path-scoped Edit + git -C prefixes + merge grant, no dangerous git");
    else bad("work-mode agent tool grants", at);
  }

  {
    const { buildAllowedTools, BASE_TOOLS } = await import("../core/prompt.mjs");
    const at = buildAllowedTools({ slug: "lean", workRepos: null });
    if (at === BASE_TOOLS.join(",") && !at.includes("Edit(")) ok("agent without workRepos stays read-only");
    else bad("agent without workRepos stays read-only", at);
  }

  {
    const before = dryCount();
    await post("scout", mention("Ev-mem-scout"));
    await post("builder", mention("Ev-mem-builder"));
    await waitForDry(before + 2);
    const { loadMemory } = await import("../core/prompt.mjs");
    const good = lastDryFor("scout")?.memoryLoaded === true && lastDryFor("builder")?.memoryLoaded === false && loadMemory({}).loaded === false;
    if (good) ok("memory: seeded agent loads MEMORY.md, unseeded agent runs without (no crash)");
    else bad("memory wiring", `scout=${lastDryFor("scout")?.memoryLoaded} builder=${lastDryFor("builder")?.memoryLoaded}`);
  }

  {
    const { stripSentinel } = await import("./turn.mjs");
    const good = stripSentinel("NO_REPLY") === "" && stripSentinel("**NO_REPLY**") === "" && stripSentinel("Thinking…\n\nNO_REPLY") === "Thinking…" && stripSentinel("A real answer") === "A real answer";
    if (good) ok("NO_REPLY sentinel never posts as visible text");
    else bad("NO_REPLY sentinel stripping");
  }

  {
    const { toSlackMessage } = await import("./format-blocks.mjs");
    const plain = toSlackMessage("Just **bold** and [a link](https://example.com)");
    const report = toSlackMessage("# Title\n\n## Section\n- one\n\n| A | B |\n|---|---|\n| x | y |");
    const good = !plain.blocks && plain.text.includes("*bold*") && plain.text.includes("<https://example.com|a link>") &&
      report.blocks?.[0]?.type === "header" && report.text.includes("• *x* · B: y");
    if (good) ok("markdown → Slack mrkdwn / Block Kit conversion");
    else bad("markdown conversion", JSON.stringify({ plain, report }).slice(0, 300));
  }

  server.close();
  if (failures) { console.error(`\n${failures} check(s) FAILED`); process.exit(1); }
  console.log("\nall checks passed");
  process.exit(0);
}

main().catch((e) => { console.error(`selftest crashed: ${e.stack || e.message}`); process.exit(1); });
