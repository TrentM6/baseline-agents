// config.mjs: paths, env loading, the agent registry, and report channels.
//
// Every surface (the CLI, Claude Code subagents, Slack, automations, the
// gateway) reads agents from here, so an agent is defined once and behaves the
// same wherever it runs. Nothing in this file knows about Slack.
import { readFileSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** The agents repo root (where agents, kb, memory, skills live). */
export const ROOT = process.env.AGENTS_ROOT || path.resolve(HERE, "..");

/** The env file holding every secret. Override with AGENTS_ENV_FILE. */
export const ENV_FILE = process.env.AGENTS_ENV_FILE || path.join(ROOT, ".env");

export const REGISTRY_FILE = process.env.AGENTS_REGISTRY || path.join(ROOT, "agents", "agents.json");
export const CHANNELS_FILE = process.env.AGENTS_CHANNELS || path.join(ROOT, "config", "channels.yaml");
export const GATEWAY_FILE = process.env.AGENTS_GATEWAY_CONFIG || path.join(ROOT, "config", "gateway.yaml");

/** The gateway is optional. It is ON when config/gateway.yaml exists (create
 * it with `npm run gateway:on`), unless AGENTS_GATEWAY=off. With it off,
 * agents use Claude Code's own tools, limited by each run's allowlist. */
export function gatewayEnabled() {
  if (process.env.AGENTS_GATEWAY === "off") return false;
  return existsSync(process.env.AGENTS_GATEWAY_CONFIG || GATEWAY_FILE);
}

/** Parse a shell-style KEY=VALUE file. Ignores comments and blanks, strips
 * quotes and a leading `export`. Returns null if the file can't be read. */
export function parseEnvFile(file) {
  let raw;
  try { raw = readFileSync(file, "utf8"); } catch { return null; }
  const out = {};
  for (const line of raw.split("\n")) {
    const s = line.trim();
    if (!s || s.startsWith("#")) continue;
    const eq = s.indexOf("=");
    if (eq < 0) continue;
    const k = s.slice(0, eq).trim().replace(/^export\s+/, "");
    let v = s.slice(eq + 1).trim();
    if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) v = v.slice(1, -1);
    out[k] = v;
  }
  return out;
}

/** Merge .env into process.env once at boot so spawned `claude` processes
 * inherit credentials. Values already in process.env win. */
export function loadSharedEnv() {
  const shared = parseEnvFile(ENV_FILE) || {};
  for (const [k, v] of Object.entries(shared)) if (process.env[k] === undefined) process.env[k] = v;
}

/** Live value of one env key: process.env first, then a fresh read of .env,
 * so credentials added while a process runs are picked up without a restart. */
export function envValue(key) {
  if (process.env[key]) return process.env[key];
  return (parseEnvFile(ENV_FILE) || {})[key] || "";
}

/** Warn (never fail) when no API key is configured: `claude` then falls back
 * to whatever login is on the machine, possibly a personal subscription, which
 * Anthropic's terms don't allow for agents other people talk to. */
export function warnIfNoApiKey(where) {
  if (process.env.ANTHROPIC_API_KEY) return;
  console.error(
    `[${where}] WARNING: ANTHROPIC_API_KEY is not set, so Claude Code will use whatever login is on this machine. ` +
      "Agents that other people talk to need an API key. See README, Claude credentials."
  );
}

/** `scout` → `SCOUT`, `my-agent` → `MY_AGENT`. Names per-agent secrets. */
export const envSlug = (slug) => String(slug).toUpperCase().replace(/[^A-Z0-9]+/g, "_");

// The registry hot-reloads on mtime change, so a roster or permission change
// takes effect on the next turn without a restart.
let registry = null;
let registryMtime = 0;
export function loadAgents() {
  const mtime = statSync(REGISTRY_FILE).mtimeMs;
  if (!registry || mtime !== registryMtime) {
    const doc = JSON.parse(readFileSync(REGISTRY_FILE, "utf8"));
    // Keys starting with "_" are comments, not agents.
    registry = Object.fromEntries(Object.entries(doc).filter(([k]) => !k.startsWith("_")));
    registryMtime = mtime;
  }
  return registry;
}

/** The live roster: every agent's public identity. Personas never hardcode
 * who else is on the team; each turn gets this list. */
export function roster() {
  return Object.entries(loadAgents()).map(([slug, meta]) => ({
    slug,
    name: meta.name,
    role: meta.role || "",
    description: meta.description || "",
    // Slack only fires a mention on a real `<@USER_ID>`. Used by the Slack
    // adapter; ignored everywhere else.
    slackUserId: meta.slackUserId || null,
  }));
}

/** Resolve one agent's definition. Unknown slug → null. */
export function resolveAgent(slug) {
  const meta = loadAgents()[slug];
  if (!meta) return null;
  return {
    slug,
    name: meta.name,
    role: meta.role || "",
    // Its identity in the gateway's allowlist (config/gateway.yaml), if the
    // gateway is on. Same on every surface.
    caller: meta.caller || `agent-${slug}`,
    description: meta.description || "",
    personaPath: path.join(ROOT, "agents", meta.persona || `personas/${slug}.md`),
    // Optional {name: {path, repo, autoMerge, writePaths}}: repos this agent
    // may change (see buildAllowedTools in core/prompt.mjs).
    workRepos: meta.workRepos || null,
    // Model ALIAS ("haiku", "sonnet", "opus"), never a dated model ID.
    model: meta.model || "sonnet",
    // Extra Claude Code tools this agent may use, as permission specifiers
    // (e.g. "WebSearch", "Bash(npm test:*)", "mcp__github__get_issue" from your
    // own MCP config). Works with or without the gateway.
    tools: Array.isArray(meta.tools) ? meta.tools.map(String) : [],
    // Edit files in its working folder when run interactively as a Claude
    // Code subagent (the person still approves each edit).
    canEdit: Boolean(meta.canEdit),
    // Channel aliases (config/channels.yaml) this agent may post reports to
    // with the gateway's post_report tool. Needs the gateway.
    reportsTo: Array.isArray(meta.reportsTo) ? meta.reportsTo : [],
  };
}

export function loadPersona(personaPath) {
  try { return readFileSync(personaPath, "utf8").trim(); } catch { return ""; }
}

/** Replace ${VAR} with its live env value (empty string if unset). */
const interpolate = (v) => String(v ?? "").replace(/\$\{([A-Z0-9_]+)\}/g, (_, k) => envValue(k));

/** Report channels: {alias: {slack: "<channel id>"}} from config/channels.yaml,
 * with ${VAR} resolved from .env. A channel whose id resolves empty is listed
 * but unconfigured. */
export function loadChannels() {
  let doc = {};
  try { doc = parseYaml(readFileSync(CHANNELS_FILE, "utf8")) ?? {}; } catch { return {}; }
  const out = {};
  for (const [alias, c] of Object.entries(doc.channels ?? {})) {
    out[alias] = { slack: interpolate(c?.slack), description: c?.description ?? "" };
  }
  return out;
}
