#!/usr/bin/env node
/**
 * run-automation.mjs <name> [--trigger=schedule|manual|agent]
 *
 * Runs one automation from automations/automations.yaml via `claude -p`:
 *   lock → daily cap → run → transcript to logs/automations/<name>/<stamp>.json
 *   → one row in logs/runs.jsonl → on failure, logs/LAST_FAILURE.md + optional Slack alert.
 *
 * Usually called through scripts/run-automation.sh, which loads .env first.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { mcpArgs } from "../core/run.mjs";
import { gatewayEnabled } from "../core/config.mjs";

const ROOT = process.env.AGENTS_ROOT ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLAUDE_BIN = process.env.CLAUDE_BIN ?? "claude";
const LOGS = path.join(ROOT, "logs");

const name = process.argv[2];
const trigger = (process.argv.find((a) => a.startsWith("--trigger=")) ?? "--trigger=manual").split("=")[1];
if (!name || name.startsWith("--")) die("usage: run-automation.mjs <name> [--trigger=schedule|manual|agent]");

const envSlug = (slug) => String(slug).toUpperCase().replace(/[^A-Z0-9]+/g, "_");

// ---- config ----
const doc = parse(fs.readFileSync(path.join(ROOT, "automations/automations.yaml"), "utf8"));
const automation = doc?.automations?.[name];
if (!automation) die(`unknown automation: ${name}`);

const maxRuntimeMs = (automation.max_runtime ?? 600) * 1000;
const maxRunsPerDay = automation.max_runs_per_day ?? 6;
fs.mkdirSync(path.join(LOGS, ".locks"), { recursive: true });

// ---- lock (mkdir is atomic; a stale lock expires after max_runtime) ----
const lockDir = path.join(LOGS, ".locks", name);
try {
  fs.mkdirSync(lockDir);
} catch {
  const age = Date.now() - fs.statSync(lockDir).mtimeMs;
  if (age < maxRuntimeMs + 60_000) {
    console.error(`[run-automation] ${name} already running (lock age ${Math.round(age / 1000)}s): exiting`);
    process.exit(0);
  }
  // stale lock: the previous run died hard; take over
}
process.on("exit", () => { try { fs.rmdirSync(lockDir); } catch {} });

// ---- daily cap (scheduled runs only; manual and agent runs bypass it, logged) ----
const today = new Date().toISOString().slice(0, 10);
const scheduledToday = readRuns().filter(
  (r) => r.automation === name && r.trigger === "schedule" && r.ts?.slice(0, 10) === today
).length;
if (trigger === "schedule" && scheduledToday >= maxRunsPerDay) {
  appendRun({ ts: new Date().toISOString(), automation: name, trigger, status: "skipped_cap" });
  console.error(`[run-automation] ${name} hit daily cap (${maxRunsPerDay}): skipping`);
  process.exit(0);
}

// ---- prompt ----
let prompt;
try {
  prompt = fs.readFileSync(path.join(ROOT, automation.prompt_file), "utf8");
} catch (e) {
  const reason = `cannot read prompt file ${automation.prompt_file}: ${e.message}`;
  appendRun({ ts: new Date().toISOString(), automation: name, trigger, status: "failed", result_head: reason });
  writeFailure(new Date().toISOString(), reason, "");
  die(reason);
}

// Every automation runs headless: a denied tool can never be approved, so
// flailing against the allowlist only burns turns until the timeout.
const HEADLESS_DISCIPLINE =
  "You run unattended: no one can approve a permission prompt. Stay strictly inside your allowed tools: prefer Glob/Grep/Read over shell commands, and never write shell loops or pipelines. If a tool call is denied, do not retry it in another form; note the gap in your final summary and continue with what you can do. " +
  // An automation has no next turn: the process exits with your final message,
  // so a backgrounded command is killed unfinished while the run still logs ok.
  "NEVER run a Bash command in the background and never end your turn waiting on one. Run every command in the foreground, read its output, then continue.";

// ---- report target (optional): the gateway's post_report enforces it ----
const childEnv = { ...process.env, AGENTS_CALLER: name, AGENTS_ROOT: ROOT };
delete childEnv.SLACK_BOT_TOKEN;
const reportTo = automation.report?.to ? [].concat(automation.report.to) : [];
const reportHint = reportTo.length && gatewayEnabled()
  ? `\n\nTo share your result, use the gateway tool mcp__gateway__post_report with "to": ${reportTo.map((t) => `"${t}"`).join(" or ")}. If it says the channel isn't connected, skip the post and say so in your final message.`
  : "";

const args = [
  "-p", prompt,
  "--output-format", "json",
  "--max-turns", String(automation.max_turns ?? 40),
  "--append-system-prompt", HEADLESS_DISCIPLINE + skillsHint(automation.skills) + reportHint,
  // With the gateway on, it is the only MCP server, so account-level servers
  // can't leak into an unattended run.
  ...mcpArgs(),
];
const allowedTools = (automation.allowed_tools ?? []).join(",");
if (allowedTools) args.push("--allowedTools", allowedTools);
if (automation.model) args.push("--model", automation.model);

// Service managers start with a minimal PATH; ~/.local/bin is where the
// Claude Code installer puts `claude`.
const localBin = path.join(os.homedir(), ".local/bin");
childEnv.PATH = childEnv.PATH ? `${localBin}${path.delimiter}${childEnv.PATH}` : localBin;

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("[run-automation] WARNING: ANTHROPIC_API_KEY is not set, so Claude Code will use whatever login is on this machine. See README → Claude credentials.");
}
const startedAt = new Date();
console.error(`[run-automation] ${name} starting (trigger=${trigger})`);

execFile(
  CLAUDE_BIN,
  args,
  { cwd: ROOT, timeout: maxRuntimeMs, killSignal: "SIGKILL", maxBuffer: 32 * 1024 * 1024, env: childEnv },
  (error, stdout, stderr) => {
    const ts = startedAt.toISOString();
    const stamp = ts.replace(/[:T]/g, "-").slice(0, 19);
    const runLogDir = path.join(LOGS, "automations", name);
    fs.mkdirSync(runLogDir, { recursive: true });

    let envelope = null;
    try { envelope = JSON.parse(stdout); } catch {}
    fs.writeFileSync(path.join(runLogDir, `${stamp}.json`), envelope ? JSON.stringify(envelope, null, 2) : stdout || "(no output)");

    const failed = Boolean(error) || envelope?.is_error === true || !envelope;
    // "Degraded" = succeeded while bleeding. A run that ends ok but burned
    // several tool calls on permission denials is prompt/permission drift in
    // progress; alert before the run that finally dies.
    const denials = Array.isArray(envelope?.permission_denials) ? envelope.permission_denials.length : 0;
    // A run that signs off saying it left work "in the background" did not do
    // that work: the child died with the run. Narrow heuristic, loud on purpose.
    const abandonedBackground = !failed && /\b(?:in|into|to) the background\b/i.test(envelope?.result ?? "");
    const degraded = !failed && (denials >= 5 || abandonedBackground);

    const row = {
      ts,
      automation: name,
      trigger,
      status: failed ? "failed" : "ok",
      denials,
      subtype: envelope?.subtype ?? null,
      duration_ms: envelope?.duration_ms ?? Date.now() - startedAt.getTime(),
      turns: envelope?.num_turns ?? null,
      cost_usd: envelope?.total_cost_usd ?? null,
      input_tokens: envelope?.usage?.input_tokens ?? null,
      output_tokens: envelope?.usage?.output_tokens ?? null,
      result_head: (envelope?.result ?? "").slice(0, 160),
    };
    appendRun(row);

    if (!failed) {
      // A success retires this automation's standing failure flag. A flag for
      // a problem later runs already disproved is a bug.
      try {
        const ff = path.join(LOGS, "LAST_FAILURE.md");
        if (fs.readFileSync(ff, "utf8").includes(`- **automation**: ${name}\n`)) fs.unlinkSync(ff);
      } catch {}
    }

    if (!failed && !degraded) {
      console.error(`[run-automation] ${name} ok in ${row.duration_ms}ms (${row.turns} turns)`);
      return;
    }

    const reason = failed
      ? (error
          ? `${error.killed ? "timeout/killed" : "exit error"}: ${String(error).slice(0, 300)}`
          : `claude returned an error envelope or unparseable output${envelope?.subtype ? ` (${envelope.subtype})` : ""}${denials ? `: ${denials} permission denial(s)` : ""}`)
      : abandonedBackground
        ? `run claimed work was left "in the background": that work was killed with the run; see logs/automations/${name}/${stamp}.json`
        : `run completed but hit ${denials} permission denials: prompt/permission drift; see logs/automations/${name}/${stamp}.json`;

    if (failed) {
      writeFailure(ts, reason, (stdout + "\n" + stderr).slice(-2000));
      console.error(`[run-automation] ${name} FAILED: see logs/LAST_FAILURE.md`);
      process.exitCode = 1;
    } else {
      console.error(`[run-automation] ${name} DEGRADED: ${reason}`);
    }

    // Optional Slack alert. A self-healing automation can set
    // alert_after_failures: N so a one-off transient doesn't page; the failure
    // is still recorded above. Degraded runs always alert.
    const alertAfter = failed ? (automation.alert_after_failures ?? 1) : 1;
    const streak = failed ? consecutiveFailures(name) : 0;
    if (failed && streak < alertAfter) {
      console.error(`[run-automation] ${name} failed ${streak}/${alertAfter}: alert held`);
      return;
    }
    const alertCh = process.env.ALERT_CHANNEL_ID;
    const alertAs = process.env.ALERT_POST_AS;
    const tok = alertAs ? process.env[`SLACK_${envSlug(alertAs)}_BOT_TOKEN`] : "";
    if (!alertCh || !tok) return;
    const who = process.env.OPERATOR_SLACK_ID ? `<@${process.env.OPERATOR_SLACK_ID}> ` : "";
    const text = failed
      ? `${who}:rotating_light: automation *${name}* failed${streak > 1 ? ` (${streak} runs in a row)` : ""} (${trigger}): ${reason.slice(0, 200)}`
      : `${who}:warning: automation *${name}* is degrading (${trigger}): ${reason.slice(0, 250)}`;
    fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ channel: alertCh, text }),
    }).catch(() => {});
  }
);

/** System-prompt block naming the skills this run may load. Pairs with
 * "Skill" in allowed_tools: an automation needs both to use a skill. */
function skillsHint(skillNames) {
  if (!Array.isArray(skillNames) || skillNames.length === 0) return "";
  const lines = [];
  for (const s of skillNames) {
    if (typeof s !== "string" || !/^[a-z0-9-]+$/.test(s)) continue;
    let desc = "";
    try {
      const m = fs.readFileSync(path.join(ROOT, ".claude/skills", s, "SKILL.md"), "utf8").match(/^description:\s*(.+)$/m);
      if (m) desc = m[1].trim();
    } catch {}
    lines.push(`- ${s}${desc ? `: ${desc}` : ""}`);
  }
  if (!lines.length) return "";
  return "\n\nSkills available to you: invoke one with the Skill tool, then follow its playbook as the authoritative procedure:\n" + lines.join("\n");
}

function readRuns() {
  try {
    return fs.readFileSync(path.join(LOGS, "runs.jsonl"), "utf8").trim().split("\n").filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch {
    return [];
  }
}

function appendRun(row) {
  fs.mkdirSync(LOGS, { recursive: true });
  fs.appendFileSync(path.join(LOGS, "runs.jsonl"), JSON.stringify(row) + "\n");
}

function writeFailure(ts, reason, tail) {
  fs.mkdirSync(LOGS, { recursive: true });
  fs.writeFileSync(
    path.join(LOGS, "LAST_FAILURE.md"),
    `# Last automation failure\n\n- **automation**: ${name}\n- **when**: ${ts}\n- **trigger**: ${trigger}\n- **reason**: ${reason}\n\n## Tail of output\n\n\`\`\`\n${tail}\n\`\`\`\n`
  );
}

/** Failures in a row for this automation, newest first (current run included). */
function consecutiveFailures(n) {
  const rows = readRuns().filter((r) => r.automation === n && r.status !== "skipped_cap");
  let count = 0;
  for (let i = rows.length - 1; i >= 0 && rows[i].status === "failed"; i--) count++;
  return count;
}

function die(msg) {
  console.error(`[run-automation] ${msg}`);
  process.exit(2);
}
