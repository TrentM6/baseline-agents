// runner.mjs — the brain + Slack orchestration for one @mention or DM turn.
//
// Each turn spawns `claude -p` (Claude Code, headless) with:
//   - the agent's persona, memory, teammates, and the KB map as system prompt
//   - the MCP gateway attached (--mcp-config .mcp.json --strict-mcp-config) and
//     AGENTS_CALLER set, so the gateway applies THIS agent's tool allowlist
//   - cwd = the repo, so Read/Grep/Glob reach kb/ and skills off disk
//
// Around that: a per-thread `--resume` session (thread memory), per-thread
// serialization (two turns never clash on one session), a global concurrency
// cap, the thread history as context, and an honest error reply instead of
// silence when anything fails.
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { ROOT, loadPersona, roster } from "./config.mjs";
import { postMessage, addReaction, fetchReplies } from "./slack-api.mjs";
import { kbMap } from "./kb.mjs";
import { toSlackMessage } from "./format-blocks.mjs";

const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";
const GH_BIN = process.env.GH_BIN || "gh";
const LOG_DIR = path.join(ROOT, "logs/slack-agent");
const SESS_FILE = path.join(LOG_DIR, "sessions.json");
const OPERATOR = process.env.OPERATOR_NAME || "the operator";

// SLACK_AGENT_DRY_RUN=1 → never spawn claude or touch Slack; log the intent so
// the offline selftest can assert "the runner would have spawned".
const DRY_RUN = process.env.SLACK_AGENT_DRY_RUN === "1";
const DRYRUN_LOG = process.env.SLACK_DRYRUN_LOG || path.join(LOG_DIR, "dryrun.jsonl");

// Optional per-agent avatar: AVATAR_BASE_URL=https://example.com/avatars →
// https://example.com/avatars/<slug>.png. Needs the chat:write.customize scope.
// Unset → Slack shows the app's own icon.
const AVATAR_BASE = (process.env.AVATAR_BASE_URL || "").replace(/\/+$/, "");
const agentIconUrl = (slug) => (AVATAR_BASE ? `${AVATAR_BASE}/${slug}.png` : undefined);

const MAX_INFLIGHT = Number(process.env.SLACK_MAX_INFLIGHT || 2); // global cap across all agents/threads
const INACTIVITY_MS = 10 * 60_000; // kill a run with no output for 10 min
const MAX_TURNS = Number(process.env.SLACK_MAX_TURNS || 20);
const PROGRESS_MIN_GAP_MS = 20_000; // at most one progress line per 20s per run
const CHANNEL_MIN_GAP_MS = 1000;    // at most one message per second per channel

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.error(`[slack-runner ${new Date().toISOString()}] ${m}`);

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

// --- per-thread serialization -------------------------------------------------
const chains = new Map(); // threadKey -> Promise (turns run one at a time per thread)

// Turns currently mid-flight. A restart kills the whole process group, which
// would silently drop a running turn: the agent just never replies. The
// SIGTERM handler at the bottom uses this to post an honest notice first.
const activeTurns = new Map();

// --- at most one message per second per channel --------------------------------
const channelPost = new Map(); // channel -> { chain, last }
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

// Strip the leading <@BOTID> tokens Slack prepends to an app_mention's text.
function cleanText(text) {
  return String(text || "").replace(/^\s*(?:<@[^>]+>\s*)+/, "").trim();
}

// --- thread context: every turn sees the conversation, not one message --------
// `--resume` gives the SAME agent its own memory of a thread, but shows nothing
// said by anyone else. Without this, agents re-ask for things stated two
// messages up and can't recognize their own reply echoed back. Best-effort:
// if the fetch fails (missing scope, rate limit) the turn runs on the
// triggering message alone.
const THREAD_CTX_MESSAGES = 12;
const THREAD_CTX_MSG_CAP = 600;
function labelFor(msg) {
  if (msg.bot_profile?.name) return msg.bot_profile.name;
  const id = msg.user || null;
  if (id) {
    const peer = roster().find((a) => a.slackUserId === id);
    if (peer) return peer.name;
    return `<@${id}>`;
  }
  return "unknown";
}
async function threadContext(agent, { channel, threadTs, triggerTs }) {
  try {
    const r = await fetchReplies(agent.secrets.SLACK_BOT_TOKEN, { channel, ts: threadTs, limit: 40 });
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
      "Read the thread before answering: don't re-ask for anything already stated above, don't repeat a point already made, and if the new message just repeats something you already answered, that's an echo — reply " + NO_REPLY + ".\n\n"
    );
  } catch {
    return "";
  }
}

const shortPath = (p) => { const s = String(p || ""); return s.split("/").slice(-2).join("/") || s; };

// Map a tool_use block to a human progress phrase (null = not worth announcing).
function phaseFor(block) {
  const n = block?.name || "";
  const inp = block?.input || {};
  if (n === "Read" || n === "mcp__gateway__read_file") return `reading ${shortPath(inp.file_path || inp.path || "a file")}`;
  if (n === "Grep") return "searching the repo";
  if (n === "Glob") return "looking for files";
  if (n.startsWith("mcp__gateway__kb_")) return "searching the knowledge base";
  if (n === "Skill" || n.endsWith("_skill") || n.endsWith("list_skills")) return "loading a skill";
  if (n.startsWith("mcp__gateway__github")) return "checking GitHub";
  if (n.startsWith("mcp__gateway__")) return `using ${n.replace("mcp__gateway__", "")}`;
  return null;
}

// --- tools: a lean base, widened per repo for agents that do repo work --------
// Every agent gets read-only tools, skills, and the gateway (which applies the
// agent's own allowlist from config/gateway.yaml). Reads are scoped to the
// repo with `./**`: a bare "Read" grant reaches the whole filesystem (your
// home directory, other projects), and headless nobody would notice. An agent with `workRepos`
// ADDS, per repo, path-scoped file writes plus a fixed set of `git -C <repo>`
// prefixes. Never a bare Bash(git:*), never reset/clean/merge/rebase: nothing
// history-destroying runs headless where no human can intervene.
export const BASE_TOOLS = ["Read(./**)", "Grep(./**)", "Glob(./**)", "Skill", "mcp__gateway"];
const WORK_GIT_SUBCOMMANDS = ["status", "add", "commit", "checkout", "switch", "branch", "diff", "log", "push", "fetch", "pull", "rm"];

// Normalize workRepos to [name, path, writePaths|null, autoMerge, repo] rows.
// A value is either a path string, or { path, repo, writePaths, autoMerge }:
//   path       — folder relative to the repo root (e.g. "workspaces/website")
//   repo       — the GitHub "owner/name" it is a clone of (for PRs and merges)
//   writePaths — optional subfolders; Write/Edit are granted ONLY under these
//   autoMerge  — grant `gh pr merge --auto`. Only set this once the repo has a
//                REQUIRED CI check and branch protection; without a real check
//                "auto-merge" is an unreviewed merge to whatever deploys main.
function workRepoEntries(agent) {
  const wr = agent && agent.workRepos;
  if (!wr || typeof wr !== "object") return [];
  return Object.entries(wr).map(([name, v]) =>
    typeof v === "string"
      ? [name, v, null, false, null]
      : [name, v.path, v.writePaths || null, Boolean(v.autoMerge && v.repo), v.repo || null]);
}

// Build the single --allowedTools string for one agent.
// Coupling to know about: Claude Code's Bash(prefix:*) matcher matches the
// LITERAL command prefix. `Bash(git -C workspaces/site status:*)` only fires
// for a command that begins exactly `git -C workspaces/site status`. That is
// why workRules() tells the agent to always run `git -C <repo> <cmd>` and
// never `cd` first. The `cd` form wouldn't match, and it would let git touch
// this repo itself.
export function buildAllowedTools(agent) {
  const tools = [...BASE_TOOLS];
  for (const [, relPath, writePaths, autoMerge, repo] of workRepoEntries(agent)) {
    // File-write permission is expressed as Edit(...) rules: they govern
    // Write too. A Write(path) specifier is silently inert.
    for (const wp of writePaths || [null]) tools.push(`Edit(./${relPath}${wp ? `/${wp}` : ""}/**)`);
    for (const sub of WORK_GIT_SUBCOMMANDS) tools.push(`Bash(git -C ${relPath} ${sub}:*)`);
    // Fixed argument order (--repo right after the subcommand) so the grant
    // matches what workRules() tells the agent to type. Both bare `gh` and
    // GH_BIN are granted: models type bare `gh` whatever you tell them.
    if (autoMerge) {
      for (const bin of new Set(["gh", GH_BIN])) {
        tools.push(`Bash(${bin} pr merge --repo ${repo}:*)`);
        tools.push(`Bash(${bin} pr view --repo ${repo}:*)`);
      }
    }
  }
  // Cross-posting: the ONE Bash path to Slack, scoped to the same script every
  // automation uses. Never a bare curl.
  if (agent.crossPostChannels) tools.push("Bash(bash scripts/slack-send.sh:*)");
  return tools.join(",");
}

function workRules(entries) {
  const list = entries.map(([name, relPath, writePaths, autoMerge, repo]) =>
    `  • ${name} → ${relPath}${repo ? ` (GitHub: ${repo})` : ""}` +
    (writePaths ? `  (writable ONLY under: ${writePaths.map((w) => `${w}/`).join(", ")})` : "") +
    (autoMerge ? "  [you may merge your own PRs here — see step 6]" : "  [open a PR and stop — merging is a human's call]")).join("\n");
  return (
    "=== REPO WORK MODE ===\n" +
    "You can do real code work in these repo(s) (paths are relative to your working directory):\n" +
    `${list}\n` +
    "You may ONLY write inside the repo(s) above (where an entry lists writable paths, only under those). If a request is outside them, say so plainly and stop.\n\n" +
    "How you do repo work, EVERY time:\n" +
    "1. Always run git as `git -C <repo-path> <cmd>`. NEVER `cd` into the repo: only the `git -C <repo>` form is allowed, and it keeps git off everything else.\n" +
    "2. SYNC FIRST: `git -C <repo> checkout main && git -C <repo> pull`. Nothing refreshes your clone automatically. If pull fails, say so rather than working on a stale tree.\n" +
    "3. Work on a NEW branch: `git -C <repo> checkout -b work/<your-slug>-<short-desc>`. Never commit to or push main.\n" +
    "4. Make focused commits with clear messages.\n" +
    "5. Push: `git -C <repo> push -u origin work/<your-slug>-<short-desc>`.\n" +
    "6. Open the PR with the gateway tool `mcp__gateway__github_create_pull_request` against the GitHub repo listed above. For a repo marked [you may merge your own PRs here]: run `gh pr merge --repo <owner/name> <PR#> --auto --squash` (keep `--repo` right after `merge`; the grant is a literal prefix match), then poll `gh pr view --repo <owner/name> <PR#> --json state,mergedAt` until it reports MERGED. Report the work done only once it has merged, with the link. For other repos, opening the PR and posting the link is the correct stopping point.\n" +
    "=== END REPO WORK MODE ==="
  );
}

function crossPostRules(agent) {
  const channels = agent.crossPostChannels;
  if (!channels || !Object.keys(channels).length) return "";
  const list = Object.entries(channels).map(([name, id]) => `  • #${name} (${id})`).join("\n");
  return (
    "=== CROSS-CHANNEL POSTING ===\n" +
    "You can start a FRESH message in another channel, not just reply where you were triggered. You may post to:\n" +
    `${list}\n` +
    "How: `bash scripts/slack-send.sh <channel-id>` with the message body on stdin.\n" +
    "When: ONLY when work moves from where it was discussed to where it will be done. Never for routine chatter.\n" +
    "Every time: post exactly ONE kickoff message in the target channel, mentioning the teammate(s) who own the work with their real <@ID> from YOUR TEAMMATES — then ONE short link-back line in the original thread, referencing the target as <#channel-id>.\n" +
    "=== END CROSS-CHANNEL POSTING ==="
  );
}

// --- per-agent memory (memory/<slug>/MEMORY.md) --------------------------------
// The runner reads ONLY the MEMORY.md index and injects it as a labeled
// system-prompt section. Missing file or dir → { loaded:false } and the
// section is skipped (no error).
const MEMORY_CAP = 4000;
export function loadMemory(agent) {
  const slug = agent && agent.slug;
  if (!slug) return { loaded: false, section: "" };
  const memPath = path.join(ROOT, "memory", slug, "MEMORY.md");
  let raw;
  try { raw = readFileSync(memPath, "utf8"); } catch { return { loaded: false, section: "" }; }
  let body = raw.trim();
  if (!body) return { loaded: false, section: "" };
  if (body.length > MEMORY_CAP) body = body.slice(0, MEMORY_CAP) + "\n…memory index truncated";
  const section =
    `=== YOUR MEMORY — memory/${slug}/MEMORY.md. These are your standing preferences and corrections. ` +
    `Each line points at a file in memory/${slug}/ with the detail; read it when the line is relevant. ===\n` +
    `${body}\n=== END YOUR MEMORY ===`;
  return { loaded: true, section };
}

// --- the system prompt --------------------------------------------------------
// The exact sentinel a turn outputs to post NOTHING. Silence has to be a real
// capability, not a phrasing: two agents each politely announcing "going
// silent" AT each other keep a loop alive, because every announcement is
// itself a mention.
export const NO_REPLY = "NO_REPLY";

// Silence is offered ONLY when a BOT mentioned this agent deep inside an
// existing thread (the echo-loop case). A human mention or a top-level mention
// always requires a reply, so the escape hatch simply isn't offered there.
const SILENCE_CLAUSE =
  `If the message genuinely needs NOTHING from you — a pure acknowledgment, a repeated message you've already answered (check THREAD SO FAR), an exchange between others that mentions you only in passing — reply with exactly ${NO_REPLY} and nothing else. The runner then posts nothing. This is the ONLY way to stay silent: posting "staying silent" IS a reply and re-triggers whoever you mention. ${NO_REPLY} must be the ONLY thing you output. Never output ${NO_REPLY} when a human asked you a direct question. `;
const MUST_REPLY_CLAUSE =
  `You were directly addressed and a reply is REQUIRED. Do NOT output ${NO_REPLY}: here it would post as a literal word. Even if there is little to add, post one or two honest lines. If the request is outside your domain, still reply: hand it off with a real mention. `;

function slackRules(canBeSilent) {
  return (
    "You are replying inside Slack. Your PERSONA above defines your voice and it governs EVERY reply, overriding the default AI-assistant register. No throat-clearing openers (\"Great question\", \"Sure, I can help\"), no narrating your process, no recap closer (\"Hope this helps\", \"Let me know if…\"), no reflexive hedging. For a conversational answer: be brief (usually two to four sentences), make one sharp point with one concrete example rather than listing every angle, no rhetorical scaffolding, and leave the obvious unsaid. No markdown headers and no sign-off on a normal reply. " +
    (canBeSilent ? SILENCE_CLAUSE : MUST_REPLY_CLAUSE) +
    "For a REPORT-shaped answer (several findings, a multi-part status) use real markdown structure: `#`/`##` headings, **bold** labels, `-` lists. It renders as a formatted Slack message. Use emoji only where it adds signal. " +
    "You run HEADLESS: no one can approve a permission prompt. If a tool is denied, note the gap in one line and continue with what you can do; never retry a denied tool in another form. " +
    "Ground every factual claim in what you actually read from the repo, the knowledge base, or a gateway tool this turn. NEVER invent a person, client, project, date, filename, number, PR, or commit hash. If it isn't there, say you have no record of it. " +
    "Before saying you have no record of something, check the KB MAP below and READ any page that might cover it."
  );
}

const handoffRules = () =>
  "=== DOMAIN & HANDOFF PROTOCOL ===\n" +
  "Stay inside your own domain; YOUR TEAMMATES below says who owns what. If a request belongs to a teammate, don't do it yourself: " +
  "reply briefly and hand off with the REAL mention syntax next to their name (the literal <@ID>). Slack only fires a mention on that exact " +
  "syntax; a plain \"@Name\" does nothing. If a teammate has no ID listed, say so plainly so a human can add it to agents/agents.json. " +
  "When you finish work another AGENT asked you for, mention that agent back so the thread closes the loop.\n" +
  "=== END DOMAIN & HANDOFF PROTOCOL ===";

// Name the tool exactly: a keyword ToolSearch can rank it below list_automations
// and make it look absent.
const OPS_RULES =
  "=== OPS: RUNNING AUTOMATIONS ===\n" +
  "If your allowlist grants it, you can run an automation now with the gateway tool `trigger_automation` — this is how you re-test a " +
  "broken automation after fixing it. `list_automations` shows which ones are agent-triggerable. Load it by EXACT name: " +
  "`ToolSearch(\"select:mcp__gateway__trigger_automation\")`. Never claim a run happened without the status the tool returns.\n" +
  "=== END OPS ===";

const autonomyRules = () =>
  "=== FIX WHAT YOU CAN ===\n" +
  `When you find something broken inside what you're allowed to change (a stale KB page, a failing test, a config gap in a repo you can write), fix it through the normal branch → PR flow instead of reporting it back. Escalate to ${OPERATOR} only for what no agent can do: a credential or access only a human holds, an action outside every tool you have, or an irreversible business decision. Even then, do everything possible first, then lay out the tradeoff and recommend.\n` +
  "=== END FIX WHAT YOU CAN ===";

// Built fresh every turn from the live registry, never hardcoded in a persona.
function teammatesSection(agent) {
  const peers = roster().filter((a) => a.slug !== agent.slug);
  if (!peers.length) return "";
  const lines = peers
    .map((a) => {
      const mention = a.slackUserId ? `<@${a.slackUserId}>` : "no Slack ID on file yet — cannot be mentioned";
      return `- ${a.name} (${mention}) — ${a.role || "no role set"}. ${a.description}`;
    })
    .join("\n");
  return (
    "=== YOUR TEAMMATES — the live roster from agents/agents.json. It changes as agents are added or removed; " +
    "never assume a team beyond what's listed here. ===\n" +
    `${lines}\n=== END YOUR TEAMMATES ===`
  );
}

// --- model routing: per-agent floor + task-driven escalation -------------------
// Model ALIASES only ("sonnet", "opus"), which Claude Code resolves to the
// current release, so a new model needs no code or config change. The floor is
// the agent's `model` in agents.json; long or design/debug-shaped work
// escalates to opus regardless of floor.
const OPUS_SIGNAL_RE =
  /\b(design|architect|refactor|migrat\w*|rewrit\w*|debug\w*|investigat\w*|root cause|plan out|strateg\w*|multi-step|end-to-end|from scratch|overhaul|audit\w*|deep dive|complex|tricky|figure out why)\b/i;
const QUICK_QUESTION_RE = /^(what|when|who|where|how many|is |does |can you tell me|status|quick question)/i;

export function chooseModelAlias(agent, prompt) {
  const floor = agent.model || "sonnet";
  if (process.env.AGENTS_NO_ESCALATION === "1") return floor;
  const isWorkTurn = !!agent.workRepos && Object.keys(agent.workRepos).length > 0;
  const long = prompt.length > 600;
  const opusSignal = OPUS_SIGNAL_RE.test(prompt);
  const quickQuestion = QUICK_QUESTION_RE.test(prompt.trim()) && prompt.length < 200;
  if (quickQuestion && !opusSignal) return floor;
  if (opusSignal || (isWorkTurn && long)) return "opus";
  return floor;
}

export function buildSystem(agent, canBeSilent) {
  const persona = loadPersona(agent.personaPath);
  const map = kbMap();
  const entries = workRepoEntries(agent);
  const mem = loadMemory(agent);
  const teammates = teammatesSection(agent);
  const crossPost = crossPostRules(agent);
  return (
    `${persona}\n\n${slackRules(canBeSilent)}` +
    (teammates ? `\n\n${teammates}\n\n${handoffRules()}` : "") +
    (crossPost ? `\n\n${crossPost}` : "") +
    `\n\n${OPS_RULES}` +
    `\n\n${autonomyRules()}` +
    (mem.loaded ? `\n\n${mem.section}` : "") +
    (entries.length ? `\n\n${workRules(entries)}` : "") +
    (map ? `\n\n=== KB MAP — every page in the knowledge base (title + one-line description). Read the relevant page(s) before answering. ===\n${map}\n=== END KB MAP ===` : "")
  );
}

// --- run claude once, streaming progress to `onPhase` ------------------------
// Returns { ok, text, sessionId, reason } — never throws.
export function runClaude({ agent, prompt, system, resumeId, onPhase, source = "slack" }) {
  return new Promise((resolve) => {
    const modelAlias = chooseModelAlias(agent, prompt);
    const args = [
      "-p", prompt,
      "--output-format", "stream-json",
      "--verbose", // required for stream-json with --print
      "--max-turns", String(MAX_TURNS),
      "--allowedTools", buildAllowedTools(agent),
      "--mcp-config", path.join(ROOT, ".mcp.json"),
      "--strict-mcp-config",
      "--append-system-prompt", system,
      "--model", modelAlias,
    ];
    if (modelAlias === "opus") args.push("--fallback-model", "sonnet");
    if (resumeId) args.push("--resume", resumeId);

    // Fully headless: an out-of-allowlist tool is denied, never left waiting
    // on a human. AGENTS_CALLER tells the gateway whose allowlist to apply.
    const env = { ...process.env, AGENTS_ROOT: ROOT, AGENTS_CALLER: agent.caller };
    // Service managers start with a minimal PATH; ~/.local/bin is where the
    // Claude Code installer and many `gh` installs land.
    const localBin = path.join(os.homedir(), ".local/bin");
    env.PATH = env.PATH ? `${localBin}${path.delimiter}${env.PATH}` : localBin;
    // Only agents granted crossPostChannels get their Slack token in the
    // child's env. Every other agent's reply is posted by THIS process after
    // the turn ends; the child never sees a token.
    if (agent.crossPostChannels && agent.secrets?.SLACK_BOT_TOKEN) {
      env.SLACK_BOT_TOKEN = agent.secrets.SLACK_BOT_TOKEN;
    } else {
      delete env.SLACK_BOT_TOKEN;
    }

    const child = spawn(CLAUDE_BIN, args, { cwd: ROOT, env });
    let buf = "";
    let finalText = "";
    let sessionId = resumeId || null;
    let isError = false;
    let costUsd = null;
    let inputTokens = 0;
    let outputTokens = 0;
    let numTurns = null;
    let killer = null;
    const bump = () => { if (killer) clearTimeout(killer); killer = setTimeout(() => { log(`inactivity kill (${agent.slug})`); try { child.kill("SIGKILL"); } catch {} }, INACTIVITY_MS); };
    bump();

    child.stdout.on("data", (d) => {
      bump();
      buf += d.toString();
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        let ev; try { ev = JSON.parse(line); } catch { continue; }
        if (ev.type === "system" && ev.session_id) sessionId = ev.session_id;
        else if (ev.type === "assistant") {
          for (const b of ev.message?.content || []) {
            if (b.type === "tool_use") { const p = phaseFor(b); if (p) onPhase?.(p); }
          }
        } else if (ev.type === "result") {
          if (ev.session_id) sessionId = ev.session_id;
          isError = ev.is_error === true;
          if (typeof ev.result === "string") finalText = ev.result.trim();
          if (typeof ev.total_cost_usd === "number") costUsd = ev.total_cost_usd;
          if (typeof ev.num_turns === "number") numTurns = ev.num_turns;
          if (ev.usage) {
            inputTokens =
              Number(ev.usage.input_tokens ?? 0) +
              Number(ev.usage.cache_creation_input_tokens ?? 0) +
              Number(ev.usage.cache_read_input_tokens ?? 0);
            outputTokens = Number(ev.usage.output_tokens ?? 0);
          }
        }
      }
    });
    // stderr is never printed (it may hold prompts) but its tail is kept for
    // failure forensics; "exit:1" alone is not debuggable.
    let errTail = "";
    child.stderr.on("data", (d) => { errTail = (errTail + d.toString()).slice(-2000); });

    const append = (file, row) => {
      try { mkdirSync(LOG_DIR, { recursive: true }); appendFileSync(path.join(LOG_DIR, file), JSON.stringify(row) + "\n"); } catch {}
    };
    const recordFailure = (reason) => append("failures.jsonl", {
      ts: new Date().toISOString(), slug: agent.slug, source, reason,
      result_tail: finalText.slice(-500), stderr_tail: errTail.slice(-800),
    });
    // One row per turn, success or failure: run counts, cost, and tokens.
    const recordRun = (ok, reason) => append("runs.jsonl", {
      ts: new Date().toISOString(), slug: agent.slug, source, model: modelAlias, ok, reason: reason ?? null,
      cost_usd: costUsd, input_tokens: inputTokens, output_tokens: outputTokens, num_turns: numTurns,
    });

    child.on("error", (e) => {
      if (killer) clearTimeout(killer);
      recordFailure(`spawn:${e.message}`); recordRun(false, `spawn:${e.message}`);
      resolve({ ok: false, text: "", sessionId, reason: `spawn:${e.message}`, stderr: errTail });
    });
    child.on("close", (code) => {
      if (killer) clearTimeout(killer);
      const ok = code === 0 && !isError && !!finalText;
      const reason = ok ? null : `exit:${code}${isError ? " is_error" : ""}`;
      if (!ok) recordFailure(reason);
      recordRun(ok, reason);
      resolve({ ok, text: finalText, sessionId, reason, stderr: errTail, costUsd });
    });
  });
}

// Strip a standalone or trailing NO_REPLY so the literal word can never post as
// visible text. Returns "" when the whole output was the sentinel.
const stripDeco = (s) => s.trim().replace(/^[*_`\s]+|[*_`\s]+$/g, "");
export function stripSentinel(t) {
  const lines = String(t).trim().split("\n").map((l) => l.trim());
  while (lines.length && stripDeco(lines[lines.length - 1]) === NO_REPLY) lines.pop();
  const kept = lines.join("\n").trim();
  return stripDeco(kept) === NO_REPLY ? "" : kept;
}

// --- one full turn: ack → run → progress → final (or honest error) -----------
async function runTurn(agent, ev) {
  const channel = ev.channel;
  const threadTs = ev.thread_ts || ev.ts; // reply IN-thread; a bare mention roots its own thread
  const threadKey = `${channel}:${threadTs}`;
  const user = ev.user || null; // bot-authored triggers have bot_id, not user
  const mentionPrefix = user ? `<@${user}> ` : "";
  const text = cleanText(ev.text) || "(you were mentioned with no text — greet them and ask what they need)";
  const token = agent.secrets.SLACK_BOT_TOKEN;
  const icon = agentIconUrl(agent.slug);
  const post = (args) => ratedPost(token, channel, icon ? { ...args, icon_url: icon } : args);

  if (DRY_RUN) {
    try { mkdirSync(path.dirname(DRYRUN_LOG), { recursive: true }); } catch {}
    appendFileSync(DRYRUN_LOG, JSON.stringify({ ts: new Date().toISOString(), slug: agent.slug, threadKey, user, text: text.slice(0, 200), allowedTools: buildAllowedTools(agent), memoryLoaded: loadMemory(agent).loaded }) + "\n");
    log(`DRY RUN — would spawn claude for ${agent.slug} in ${threadKey}: "${text.slice(0, 60)}"`);
    return;
  }

  await acquire();
  activeTurns.set(threadKey, { agent, token, channel, threadTs });
  try {
    // The 👀 reaction is the only immediate ack. No "on it" message: one
    // mention = one message, the answer. Progress lines only start once a run
    // has gone on for PROGRESS_MIN_GAP_MS.
    try { await addReaction(token, { channel, timestamp: ev.ts, name: "eyes" }); } catch {}

    const fromBot = Boolean(ev.bot_id) || ev.subtype === "bot_message";
    const isTopLevel = !ev.thread_ts || ev.thread_ts === ev.ts;
    const canBeSilent = fromBot && !isTopLevel;
    const system = buildSystem(agent, canBeSilent);
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

    const ctx = await threadContext(agent, { channel, threadTs, triggerTs: ev.ts });
    const prompt = ctx ? `${ctx}The new message addressed to you:\n${text}` : text;

    log(`turn ${agent.slug} ${threadKey} (resume=${sessions[threadKey] ? "y" : "n"}, ctx=${ctx ? "y" : "n"})`);
    let r = await runClaude({ agent, prompt, system, resumeId: sessions[threadKey] || null, onPhase });
    // A stale --resume id fails the run; retry once fresh so a rotated session
    // can't wedge a thread permanently.
    if (!r.ok && sessions[threadKey]) {
      log(`resume failed for ${threadKey} (${r.reason}) — retrying without --resume`);
      delete sessions[threadKey]; saveSessions();
      r = await runClaude({ agent, prompt, system, resumeId: null, onPhase });
    }
    if (r.sessionId) { sessions[threadKey] = r.sessionId; saveSessions(); }

    if (!r.ok) {
      log(`turn FAILED ${agent.slug} ${threadKey}: ${r.reason}`);
      await post({ text: `${mentionPrefix}hit an error on that one — details are in my logs. Mind trying again?`, thread_ts: threadTs });
      return;
    }

    let replyText = stripSentinel(r.text);
    const wantedSilence = replyText === "";
    if (wantedSilence && canBeSilent) {
      log(`no-reply ${agent.slug} ${threadKey} (agent chose silence)`);
      return;
    }
    if (wantedSilence) {
      // A reply was required but the agent emitted only the sentinel. Ask
      // once more, explicitly; then fall back to an honest minimal line.
      log(`forced-reply ${agent.slug} ${threadKey}: ${NO_REPLY} on a required reply — retrying`);
      const forcePrompt = prompt + `\n\n[SYSTEM: A reply is REQUIRED — you were directly addressed. Reply now with one or two honest lines. Do NOT output ${NO_REPLY}.]`;
      const f = await runClaude({ agent, prompt: forcePrompt, system, resumeId: sessions[threadKey] || null, onPhase });
      if (f.sessionId) { sessions[threadKey] = f.sessionId; saveSessions(); }
      if (f.ok) replyText = stripSentinel(f.text);
      if (!replyText) replyText = "Nothing new from me on this one.";
    }
    // Put the mention on its own line when the reply opens with a heading, so
    // it doesn't break the "# " match in the Block Kit conversion.
    const body = /^#{1,3} /.test(replyText) ? `${mentionPrefix}\n\n${replyText}` : `${mentionPrefix}${replyText}`;
    const { text: slackText, blocks } = toSlackMessage(body);
    await post({ text: slackText, blocks, thread_ts: threadTs });
    log(`replied ${agent.slug} ${threadKey}`);
  } catch (err) {
    log(`turn EXCEPTION ${agent.slug} ${threadKey}: ${err.message}`);
    try { await post({ text: `${mentionPrefix}hit an error on that one — details are in my logs. Mind trying again?`, thread_ts: threadTs }); } catch {}
  } finally {
    activeTurns.delete(threadKey);
    release();
  }
}

/** Public entry, called by receiver.mjs after it has ack'd Slack. Serializes
 * per thread; never throws (failures become a threaded error reply). */
export function handleEvent(agent, ev) {
  const threadKey = `${ev.channel}:${ev.thread_ts || ev.ts}`;
  const prev = chains.get(threadKey) || Promise.resolve();
  const job = prev.then(() => runTurn(agent, ev)).catch((e) => log(`chain error ${threadKey}: ${e.message}`));
  chains.set(threadKey, job.finally(() => { if (chains.get(threadKey) === job) chains.delete(threadKey); }));
  return job;
}

// On shutdown, post one honest notice per in-flight turn before exiting, so a
// restart reads as "got interrupted, retry" instead of silence. Only the
// receiver installs this (scripts/ask.mjs imports this module too).
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  const turns = [...activeTurns.values()];
  activeTurns.clear();
  if (turns.length) {
    log(`${signal} — announcing ${turns.length} interrupted turn(s) before exit`);
    await Promise.all(turns.map((t) => {
      const icon = agentIconUrl(t.agent.slug);
      return postMessage(t.token, {
        channel: t.channel,
        thread_ts: t.threadTs,
        text: `${t.agent.name} got interrupted by a restart mid-turn — mind sending that again?`,
        ...(icon ? { icon_url: icon } : {}),
      }).catch(() => {});
    }));
  } else {
    log(`${signal} — no in-flight turns, exiting clean`);
  }
  process.exit(0);
}
export function installShutdownHandlers() {
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
