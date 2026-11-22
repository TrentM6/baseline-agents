// config.mjs — paths, env loading, and the agent registry.
//
// Every other module asks this file where things live, so moving the repo or
// pointing a test at a temp dir is one env var, never a code edit.
//
// Secrets are re-read from .env on every Slack request (not cached at boot):
// you can add an agent's Slack credentials while the receiver is running and the
// next event picks them up, and an agent with no credentials yet returns 503
// while the others keep serving.
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Repo root. Override with AGENTS_ROOT (the selftest does). */
export const ROOT = process.env.AGENTS_ROOT || path.resolve(HERE, "..");

/** The env file holding every secret. Override with AGENTS_ENV_FILE. */
export const ENV_FILE = process.env.AGENTS_ENV_FILE || path.join(ROOT, ".env");

export const REGISTRY_FILE = process.env.AGENTS_REGISTRY || path.join(ROOT, "agents", "agents.json");

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

/** Live value of one env key: process.env first, then a fresh read of .env. */
export function envValue(key) {
  if (process.env[key]) return process.env[key];
  return (parseEnvFile(ENV_FILE) || {})[key] || "";
}

/** `scout` → `SCOUT`, `my-agent` → `MY_AGENT`. Used to name per-agent secrets:
 * SLACK_<SLUG>_SIGNING_SECRET and SLACK_<SLUG>_BOT_TOKEN. */
export const envSlug = (slug) => String(slug).toUpperCase().replace(/[^A-Z0-9]+/g, "_");

/** Slack credentials for one agent, read fresh. Null if either is missing. */
export function slackSecrets(slug) {
  const k = envSlug(slug);
  const signing = envValue(`SLACK_${k}_SIGNING_SECRET`);
  const bot = envValue(`SLACK_${k}_BOT_TOKEN`);
  return signing && bot ? { SLACK_SIGNING_SECRET: signing, SLACK_BOT_TOKEN: bot } : null;
}

// The registry hot-reloads on mtime change. A permission or roster change
// would otherwise sit inert until someone remembered to restart the receiver,
// and a stale permission model is an incident. One stat per call is cheap.
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
 * who else is on the team; the runner builds each agent's "your teammates"
 * section from this every turn, so adding or removing an agent needs zero
 * persona edits. */
export function roster() {
  return Object.entries(loadAgents()).map(([slug, meta]) => ({
    slug,
    name: meta.name,
    role: meta.role || "",
    description: meta.description || "",
    // Slack only fires app_mention on a real `<@USER_ID>` mention. Plain
    // "@Name" text never triggers another agent. Fill this in after you
    // install the agent's Slack app.
    slackUserId: meta.slackUserId || null,
  }));
}

/** Resolve one agent plus its live secrets.
 *   unknown slug          → null              (receiver → 404)
 *   no Slack creds yet    → { …, secrets:null } (receiver → 503)
 *   complete              → { …, secrets:{…} } */
export function resolveAgent(slug) {
  const meta = loadAgents()[slug];
  if (!meta) return null;
  return {
    slug,
    name: meta.name,
    role: meta.role || "",
    caller: meta.caller || `slack-${slug}`,
    description: meta.description || "",
    personaPath: path.join(ROOT, "agents", meta.persona || `personas/${slug}.md`),
    // Optional {name: {path, repo, autoMerge}} map. Present → the runner adds
    // path-scoped write + git tools for those repos (see buildAllowedTools).
    workRepos: meta.workRepos || null,
    // Default model ALIAS ("sonnet", "opus", "haiku"), never a dated model ID,
    // so a new model release needs no config change.
    model: meta.model || "sonnet",
    // Optional {name: channelId} map of channels this agent may start a fresh
    // message in. Absent → the agent can only reply where it was triggered.
    crossPostChannels: meta.crossPostChannels || null,
    secrets: slackSecrets(slug),
  };
}

export function loadPersona(personaPath) {
  try { return readFileSync(personaPath, "utf8").trim(); } catch { return ""; }
}
