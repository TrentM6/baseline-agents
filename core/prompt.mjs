// prompt.mjs: everything that makes an agent THAT agent, on every surface.
//
// buildSystem() assembles the system prompt from the persona, memory,
// teammates, the knowledge-base map, repo-work rules and report rules.
// buildAllowedTools() assembles its Claude Code tool allowlist. A surface
// (Slack, the CLI, a Claude Code subagent, an automation) adds only its own
// etiquette on top through `surfaceRules`; the agent itself stays identical.
import { readFileSync } from "node:fs";
import path from "node:path";
import { ROOT, loadPersona, roster, loadChannels, gatewayEnabled } from "./config.mjs";
import { kbMap } from "./kb.mjs";

const GH_BIN = process.env.GH_BIN || "gh";
const OPERATOR = process.env.OPERATOR_NAME || "the operator";

// --- tools: a lean base, widened per repo for agents that do repo work --------
// Every agent gets read-only file tools and skills. Reads are scoped to the
// working directory with `./**`: a bare "Read" grant reaches the whole
// filesystem, and headless nobody would notice. On top of that: the agent's
// own `tools` from agents.json, and the gateway if it's on (the gateway then
// applies the agent's allowlist from config/gateway.yaml).
export const BASE_TOOLS = ["Read(./**)", "Grep(./**)", "Glob(./**)", "Skill"];
const WORK_GIT_SUBCOMMANDS = ["status", "add", "commit", "checkout", "switch", "branch", "diff", "log", "push", "fetch", "pull", "rm"];

// Normalize workRepos to [name, path, writePaths|null, autoMerge, repo] rows.
//   path       folder relative to the agents repo root (e.g. "workspaces/site")
//   repo       the GitHub "owner/name" it is a clone of (for PRs and merges)
//   writePaths optional subfolders; writes are granted ONLY under these
//   autoMerge  grant `gh pr merge --auto`. Only for a repo with a REQUIRED CI
//              check and branch protection; otherwise it's an unreviewed merge.
export function workRepoEntries(agent) {
  const wr = agent && agent.workRepos;
  if (!wr || typeof wr !== "object") return [];
  return Object.entries(wr).map(([name, v]) =>
    typeof v === "string"
      ? [name, v, null, false, null]
      : [name, v.path, v.writePaths || null, Boolean(v.autoMerge && v.repo), v.repo || null]);
}

/**
 * The --allowedTools string for one agent.
 *   opts.home       absolute agents-repo root when the run's cwd is ELSEWHERE
 *                   (`ask --in <dir>`): adds read access to the agents repo
 *   opts.allowEdits grant file writes inside the run's cwd (`--allow-edits`)
 *
 * Two Claude Code permission facts this depends on:
 *  - File writes are governed by Edit(path) rules. A Write(path) rule is
 *    silently ignored.
 *  - Bash(prefix:*) matches the LITERAL start of a command, which is why repo
 *    work is always `git -C <repo> <cmd>` and never `cd` first.
 */
export function buildAllowedTools(agent, opts = {}) {
  const tools = [...BASE_TOOLS];
  const gateway = opts.gateway ?? gatewayEnabled();
  if (gateway) tools.push("mcp__gateway");
  for (const t of agent.tools || []) if (!tools.includes(t)) tools.push(t);
  if (opts.home) tools.push(`Read(/${opts.home}/**)`); // `//abs/path` = absolute
  if (opts.allowEdits) tools.push("Edit(./**)");
  // Repo grants are relative to the agents repo, so they only apply when the
  // run's cwd IS the agents repo.
  if (!opts.home) {
    for (const [, relPath, writePaths, autoMerge, repo] of workRepoEntries(agent)) {
      for (const wp of writePaths || [null]) tools.push(`Edit(./${relPath}${wp ? `/${wp}` : ""}/**)`);
      for (const sub of WORK_GIT_SUBCOMMANDS) tools.push(`Bash(git -C ${relPath} ${sub}:*)`);
      if (repo) for (const bin of new Set(["gh", GH_BIN])) tools.push(`Bash(${bin} pr create --repo ${repo}:*)`);
      // Both bare `gh` and GH_BIN: models type bare `gh` whatever you tell them.
      if (autoMerge) {
        for (const bin of new Set(["gh", GH_BIN])) {
          tools.push(`Bash(${bin} pr merge --repo ${repo}:*)`);
          tools.push(`Bash(${bin} pr view --repo ${repo}:*)`);
        }
      }
    }
  }
  return tools.join(",");
}

function workRules(entries) {
  const list = entries.map(([name, relPath, writePaths, autoMerge, repo]) =>
    `  • ${name} → ${relPath}${repo ? ` (GitHub: ${repo})` : ""}` +
    (writePaths ? `  (writable ONLY under: ${writePaths.map((w) => `${w}/`).join(", ")})` : "") +
    (autoMerge ? "  [you may merge your own PRs here, see step 6]" : "  [open a PR and stop; merging is a human's call]")).join("\n");
  return (
    "=== REPO WORK MODE ===\n" +
    "You can do real code work in these repo(s) (paths are relative to your working directory):\n" +
    `${list}\n` +
    "You may ONLY write inside the repo(s) above (where an entry lists writable paths, only under those). If a request is outside them, say so plainly and stop.\n\n" +
    "How you do repo work, EVERY time:\n" +
    "1. Always run git as `git -C <repo-path> <cmd>`. NEVER `cd` into the repo: only the `git -C <repo>` form is allowed.\n" +
    "2. SYNC FIRST: `git -C <repo> checkout main && git -C <repo> pull`. If pull fails, say so rather than working on a stale tree.\n" +
    "3. Work on a NEW branch: `git -C <repo> checkout -b work/<your-slug>-<short-desc>`. Never commit to or push main.\n" +
    "4. Make focused commits with clear messages.\n" +
    "5. Push: `git -C <repo> push -u origin work/<your-slug>-<short-desc>`.\n" +
    "6. Open the PR: `gh pr create --repo <owner/name> --head work/<your-slug>-<short-desc> --title \"...\" --body \"...\"` (keep `--repo` right after `create`; the grant is a literal prefix match). For a repo marked [you may merge your own PRs here]: run `gh pr merge --repo <owner/name> <PR#> --auto --squash` (keep `--repo` right after `merge`; the grant is a literal prefix match), then poll `gh pr view --repo <owner/name> <PR#> --json state,mergedAt` until it reports MERGED. Report the work done only once it has merged, with the link. For other repos, opening the PR and posting the link is the correct stopping point.\n" +
    "=== END REPO WORK MODE ==="
  );
}

// --- reporting: post a result to a channel, from any surface ------------------
function reportRules(agent) {
  if (!agent.reportsTo.length || !gatewayEnabled()) return "";
  const channels = loadChannels();
  const lines = agent.reportsTo.map((alias) => {
    const c = channels[alias];
    const state = !c ? "not defined in config/channels.yaml" : c.slack ? "Slack" : "not connected yet";
    return `  • ${alias} (${state})${c?.description ? `: ${c.description}` : ""}`;
  });
  return (
    "=== REPORTING ===\n" +
    "You can post a result to these channels with the gateway tool `mcp__gateway__post_report`, wherever you are running:\n" +
    `${lines.join("\n")}\n` +
    `Call it with { "to": "<channel>", "as": "${agent.slug}", "text": "<markdown>" }. Post ONE message when there's a finished result worth sharing (a finished design, a decision, a report), never progress chatter. If the tool says the channel isn't connected, tell the person you couldn't post and give them the text instead.\n` +
    "=== END REPORTING ==="
  );
}

// --- memory (memory/<slug>/MEMORY.md) -------------------------------------------
const MEMORY_CAP = 4000;
export function loadMemory(agent) {
  const slug = agent && agent.slug;
  if (!slug) return { loaded: false, section: "", body: "" };
  let raw;
  try { raw = readFileSync(path.join(ROOT, "memory", slug, "MEMORY.md"), "utf8"); } catch { return { loaded: false, section: "", body: "" }; }
  let body = raw.trim();
  if (!body) return { loaded: false, section: "", body: "" };
  if (body.length > MEMORY_CAP) body = body.slice(0, MEMORY_CAP) + "\n…memory index truncated";
  const section =
    `=== YOUR MEMORY: memory/${slug}/MEMORY.md. These are your standing preferences and corrections. ` +
    `Each line points at a file in memory/${slug}/ with the detail; read it when the line is relevant. ===\n` +
    `${body}\n=== END YOUR MEMORY ===`;
  return { loaded: true, section, body };
}

// --- shared rules ---------------------------------------------------------------
export const GROUNDING_RULES =
  "Ground every factual claim in what you actually read this turn from the knowledge base, the files, or a tool. NEVER invent a person, client, project, date, filename, number, PR, or commit hash. If it isn't there, say you have no record of it. " +
  "Before saying you have no record of something, check the KB MAP and READ any page that might cover it.";

const OPS_RULES =
  "=== OPS: RUNNING AUTOMATIONS ===\n" +
  "If your allowlist grants it, you can run an automation now with the gateway tool `trigger_automation`, which is how you re-test a " +
  "broken automation after fixing it. `list_automations` shows which ones are agent-triggerable. Load it by EXACT name: " +
  "`ToolSearch(\"select:mcp__gateway__trigger_automation\")`. Never claim a run happened without the status the tool returns.\n" +
  "=== END OPS ===";

const autonomyRules = () =>
  "=== FIX WHAT YOU CAN ===\n" +
  `When you find something broken inside what you're allowed to change (a stale KB page, a failing test, a config gap in a repo you can write), fix it through the normal branch and PR flow instead of reporting it back. Escalate to ${OPERATOR} only for what no agent can do: a credential or access only a human holds, an action outside every tool you have, or an irreversible business decision. Even then, do everything possible first, then lay out the tradeoff and recommend.\n` +
  "=== END FIX WHAT YOU CAN ===";

// Built fresh every turn from the live registry, never hardcoded in a persona.
// `mentions` = Slack: show the real <@ID> syntax and the hand-off protocol.
function teammatesSection(agent, { mentions }) {
  const peers = roster().filter((a) => a.slug !== agent.slug);
  if (!peers.length) return "";
  const lines = peers.map((a) => {
    const how = mentions ? ` (${a.slackUserId ? `<@${a.slackUserId}>` : "no Slack ID on file yet, cannot be mentioned"})` : "";
    return `- ${a.name}${how}: ${a.role || "no role set"}. ${a.description}`;
  }).join("\n");
  const protocol = mentions
    ? "Stay inside your own domain. If a request belongs to a teammate, don't do it yourself: reply briefly and hand off with the REAL mention syntax next to their name (the literal <@ID>). A plain \"@Name\" does nothing. When you finish work another AGENT asked you for, mention that agent back so the thread closes the loop."
    : "Stay inside your own domain. If a request belongs to a teammate, say so in one line and name them, so the person can ask that agent directly.";
  return (
    "=== YOUR TEAMMATES: the live roster from agents/agents.json. Never assume a team beyond what's listed here. ===\n" +
    `${lines}\n${protocol}\n=== END YOUR TEAMMATES ===`
  );
}

// --- model routing ----------------------------------------------------------------
// Aliases only ("sonnet", "opus"); Claude Code resolves them to the current
// release. Long or design- and debug-shaped work escalates to opus.
const OPUS_SIGNAL_RE =
  /\b(design|architect|refactor|migrat\w*|rewrit\w*|debug\w*|investigat\w*|root cause|plan out|strateg\w*|multi-step|end-to-end|from scratch|overhaul|audit\w*|deep dive|complex|tricky|figure out why)\b/i;
const QUICK_QUESTION_RE = /^(what|when|who|where|how many|is |does |can you tell me|status|quick question)/i;

export function chooseModelAlias(agent, prompt) {
  const floor = agent.model || "sonnet";
  if (process.env.AGENTS_NO_ESCALATION === "1") return floor;
  const isWorkTurn = !!agent.workRepos && Object.keys(agent.workRepos).length > 0;
  const opusSignal = OPUS_SIGNAL_RE.test(prompt);
  const quickQuestion = QUICK_QUESTION_RE.test(prompt.trim()) && prompt.length < 200;
  if (quickQuestion && !opusSignal) return floor;
  if (opusSignal || (isWorkTurn && prompt.length > 600)) return "opus";
  return floor;
}

/**
 * The system prompt for one agent on one surface.
 *   opts.surfaceRules  the surface's own etiquette (Slack threads, CLI, …)
 *   opts.mentions      true on Slack: teammates listed with <@ID> mentions
 *   opts.home          absolute agents-repo root when running elsewhere
 *   opts.kbMap         false to omit the KB map (subagent files embed a pointer instead)
 */
export function buildSystem(agent, opts = {}) {
  const persona = loadPersona(agent.personaPath);
  const entries = opts.home ? [] : workRepoEntries(agent);
  const mem = loadMemory(agent);
  const teammates = teammatesSection(agent, { mentions: Boolean(opts.mentions) });
  const reports = reportRules(agent);
  const map = opts.kbMap === false ? "" : kbMap();
  const home = opts.home
    ? `=== WHERE YOU ARE ===\nYou are working in another project folder (your working directory). Your own home (knowledge base, memory, skills) is the agents repo at ${opts.home}. KB paths below are relative to it: read them as ${opts.home}/kb/... Its skills are in ${opts.home}/.claude/skills/<name>/SKILL.md: read the one you need with Read, since the Skill tool only sees this folder's skills.\n=== END WHERE YOU ARE ===`
    : "";
  return [
    persona,
    [opts.surfaceRules, GROUNDING_RULES].filter(Boolean).join(" "),
    home,
    teammates,
    reports,
    gatewayEnabled() ? OPS_RULES : "",
    autonomyRules(),
    mem.loaded ? mem.section : "",
    entries.length ? workRules(entries) : "",
    map ? `=== KB MAP: every page in the knowledge base (title + one-line description). Read the relevant page(s) before answering. ===\n${map}\n=== END KB MAP ===` : "",
  ].filter(Boolean).join("\n\n");
}
