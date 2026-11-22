// run.mjs: run ONE agent turn with Claude Code, headless. Every surface that
// runs an agent in its own process (the CLI, Slack, an app such as a design
// sandbox) calls runClaude() or runAgent(); none of them build their own.
//
// Each turn spawns `claude -p` with the agent's system prompt and allowlist.
// Anything outside the allowlist is denied. If the gateway is on, it is the
// ONLY MCP server attached, and AGENTS_CALLER tells it whose allowlist to
// apply. If it's off, Claude Code's own MCP config applies, still limited to
// the tools the agent is granted.
import { spawn } from "node:child_process";
import { mkdirSync, appendFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { ROOT, resolveAgent, loadSharedEnv, gatewayEnabled } from "./config.mjs";
import { buildSystem, buildAllowedTools, chooseModelAlias } from "./prompt.mjs";

const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";
export const LOG_DIR = path.join(ROOT, "logs", "agents");
const INACTIVITY_MS = 10 * 60_000; // kill a run with no output for 10 min
const MAX_TURNS = Number(process.env.AGENTS_MAX_TURNS || 20);
const log = (m) => console.error(`[agents ${new Date().toISOString()}] ${m}`);

/** MCP args for a headless turn: the gateway alone (inline config with
 * ABSOLUTE paths, so a turn in another folder still reaches it), or nothing. */
export const mcpArgs = () => (gatewayEnabled() ? ["--mcp-config", gatewayMcpConfig(), "--strict-mcp-config"] : []);

/** The gateway as an inline MCP config with absolute paths. */
export function gatewayMcpConfig() {
  return JSON.stringify({
    mcpServers: {
      gateway: { command: process.execPath, args: [path.join(ROOT, "gateway", "src", "index.mjs")], env: { AGENTS_ROOT: ROOT } },
    },
  });
}

// Map a tool_use block to a human progress phrase (null = not worth announcing).
const shortPath = (p) => { const s = String(p || ""); return s.split("/").slice(-2).join("/") || s; };
export function phaseFor(block) {
  const n = block?.name || "";
  const inp = block?.input || {};
  if (n === "Read" || n === "mcp__gateway__read_file") return `reading ${shortPath(inp.file_path || inp.path || "a file")}`;
  if (n === "Grep") return "searching files";
  if (n === "Glob") return "looking for files";
  if (n === "Edit" || n === "Write") return `editing ${shortPath(inp.file_path || "a file")}`;
  if (n.startsWith("mcp__gateway__kb_")) return "searching the knowledge base";
  if (n === "Skill" || n.endsWith("_skill") || n.endsWith("list_skills")) return "loading a skill";
  if (n === "mcp__gateway__post_report") return "posting a report";
  if (n.startsWith("mcp__gateway__github")) return "checking GitHub";
  if (n.startsWith("mcp__gateway__")) return `using ${n.replace("mcp__gateway__", "")}`;
  return null;
}

/**
 * Run one turn. Returns { ok, text, sessionId, reason, stderr, costUsd }; never throws.
 *   agent      from resolveAgent()
 *   system     from buildSystem()
 *   cwd        where the agent works (default: this repo). Elsewhere, the
 *              agent can still read its home repo (see buildAllowedTools).
 *   allowEdits grant file writes inside cwd
 *   surface    label for logs: "cli", "slack", "app", ...
 *   env        extra env for the child (a surface may pass tokens it owns)
 */
export function runClaude({ agent, prompt, system, resumeId = null, onPhase, surface = "cli", cwd = ROOT, allowEdits = false, env: extraEnv = {} }) {
  return new Promise((resolve) => {
    const workDir = path.resolve(cwd);
    const elsewhere = workDir !== ROOT;
    const modelAlias = chooseModelAlias(agent, prompt);
    const args = [
      "-p", prompt,
      "--output-format", "stream-json",
      "--verbose", // required for stream-json with --print
      "--max-turns", String(MAX_TURNS),
      "--allowedTools", buildAllowedTools(agent, { home: elsewhere ? ROOT : null, allowEdits }),
      ...mcpArgs(),
      "--append-system-prompt", system,
      "--model", modelAlias,
    ];
    if (elsewhere) args.push("--add-dir", ROOT);
    if (modelAlias === "opus") args.push("--fallback-model", "sonnet");
    if (resumeId) args.push("--resume", resumeId);

    // Headless: anything outside the allowlist is denied, never left waiting.
    const env = { ...process.env, AGENTS_ROOT: ROOT, AGENTS_CALLER: agent.caller, ...extraEnv };
    // An empty key (copied from .env.example) would shadow a real login.
    if (env.ANTHROPIC_API_KEY === "") delete env.ANTHROPIC_API_KEY;
    // No surface token leaks into a turn unless the surface passes it on purpose.
    if (!("SLACK_BOT_TOKEN" in extraEnv)) delete env.SLACK_BOT_TOKEN;
    // Service managers start with a minimal PATH; ~/.local/bin is where the
    // Claude Code installer and many `gh` installs land.
    const localBin = path.join(os.homedir(), ".local/bin");
    env.PATH = env.PATH ? `${localBin}${path.delimiter}${env.PATH}` : localBin;

    const child = spawn(CLAUDE_BIN, args, { cwd: workDir, env });
    let buf = "";
    let finalText = "";
    let sessionId = resumeId;
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
            inputTokens = Number(ev.usage.input_tokens ?? 0) + Number(ev.usage.cache_creation_input_tokens ?? 0) + Number(ev.usage.cache_read_input_tokens ?? 0);
            outputTokens = Number(ev.usage.output_tokens ?? 0);
          }
        }
      }
    });
    // stderr is never printed (it may hold prompts) but its tail is kept for forensics.
    let errTail = "";
    child.stderr.on("data", (d) => { errTail = (errTail + d.toString()).slice(-2000); });

    const append = (file, row) => {
      try { mkdirSync(LOG_DIR, { recursive: true }); appendFileSync(path.join(LOG_DIR, file), JSON.stringify(row) + "\n"); } catch {}
    };
    const record = (ok, reason) => {
      const base = { ts: new Date().toISOString(), slug: agent.slug, surface, cwd: elsewhere ? workDir : ".", model: modelAlias, ok, reason: reason ?? null };
      append("runs.jsonl", { ...base, cost_usd: costUsd, input_tokens: inputTokens, output_tokens: outputTokens, num_turns: numTurns });
      if (!ok) append("failures.jsonl", { ...base, result_tail: finalText.slice(-500), stderr_tail: errTail.slice(-800) });
    };

    child.on("error", (e) => {
      if (killer) clearTimeout(killer);
      record(false, `spawn:${e.message}`);
      resolve({ ok: false, text: "", sessionId, reason: `spawn:${e.message}`, stderr: errTail, costUsd });
    });
    child.on("close", (code) => {
      if (killer) clearTimeout(killer);
      const ok = code === 0 && !isError && !!finalText;
      const reason = ok ? null : `exit:${code}${isError ? " is_error" : ""}`;
      record(ok, reason);
      resolve({ ok, text: finalText, sessionId, reason, stderr: errTail, costUsd });
    });
  });
}

/** Rules for a turn whose reply goes straight back to a person in a terminal
 * or an app (not a chat thread). */
export const LOCAL_RULES =
  "Your PERSONA above defines your voice. Answer the request directly: the result first, no preamble, no recap closer. " +
  "You run HEADLESS: no one can approve a permission prompt. If a tool is denied, note the gap in one line and continue with what you can do; never retry a denied tool in another form.";

/**
 * Convenience for any surface: run agent `slug` on `prompt`.
 * Returns the runClaude() result plus { agent }.
 */
export async function runAgent({ slug, prompt, cwd = ROOT, allowEdits = false, surface = "app", surfaceRules = LOCAL_RULES, onPhase, resumeId = null }) {
  loadSharedEnv();
  const agent = resolveAgent(slug);
  if (!agent) return { ok: false, text: "", reason: `unknown agent "${slug}"`, agent: null };
  const elsewhere = path.resolve(cwd) !== ROOT;
  const system = buildSystem(agent, { surfaceRules, home: elsewhere ? ROOT : null });
  const r = await runClaude({ agent, prompt, system, resumeId, onPhase, surface, cwd, allowEdits });
  return { ...r, agent };
}
