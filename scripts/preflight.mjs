#!/usr/bin/env node
/**
 * preflight.mjs: check that your agents, automations, and gateway config
 * agree with each other, before anything runs. Run it after every config
 * change and in CI. Exit 1 = a problem that will break a run; warnings don't fail.
 *
 * Catches the expensive silent failures: a prompt that tells a headless run to
 * use a command its allowlist denies (every run burns its turns on denials),
 * a skill that isn't granted, an agent whose gateway caller doesn't exist.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { parse } from "yaml";
import { gatewayEnabled, envValue, envSlug } from "../core/config.mjs";

const ROOT = process.env.AGENTS_ROOT ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const problems = [];
const warnings = [];
const flag = (where, msg) => problems.push(`[${where}] ${msg}`);
const warn = (where, msg) => warnings.push(`[${where}] ${msg}`);
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

function load(rel, parser) {
  try {
    return parser(fs.readFileSync(path.join(ROOT, rel), "utf8"));
  } catch (e) {
    flag(rel, `does not load: ${e.message}`);
    return null;
  }
}

const gatewayOn = gatewayEnabled();
const gateway = load(gatewayOn ? "config/gateway.yaml" : "config/gateway.example.yaml", parse) ?? {};
const callers = gateway.callers ?? {};
const autoDoc = load("automations/automations.yaml", parse) ?? {};
const automations = autoDoc.automations ?? {};
const agentsDoc = load("agents/agents.json", JSON.parse) ?? {};
const agents = Object.fromEntries(Object.entries(agentsDoc).filter(([k]) => !k.startsWith("_")));
const channels = (load("config/channels.yaml", parse) ?? {}).channels ?? {};

// ---- agents ----
for (const [slug, a] of Object.entries(agents)) {
  if (!/^[a-z0-9-]+$/.test(slug)) flag(`agent ${slug}`, "slug must be lowercase letters, digits, dashes (it is part of the Slack URL)");
  if (!a.name) flag(`agent ${slug}`, "missing name");
  const persona = path.join("agents", a.persona || `personas/${slug}.md`);
  if (!exists(persona)) flag(`agent ${slug}`, `persona file missing: ${persona}`);
  const caller = a.caller || `agent-${slug}`;
  if (gatewayOn && !callers[caller]) warn(`agent ${slug}`, `no callers.${caller} in config/gateway.yaml: the agent gets no gateway tools`);
  if (!exists(`memory/${slug}/MEMORY.md`)) warn(`agent ${slug}`, `no memory/${slug}/MEMORY.md: the agent runs without memory`);
  // Only relevant once the agent is on Slack (its bot token is in .env).
  if (!a.slackUserId && envValue(`SLACK_${envSlug(slug)}_BOT_TOKEN`)) warn(`agent ${slug}`, "no slackUserId: teammates can't mention this agent in Slack until you add it");
  for (const alias of a.reportsTo ?? []) {
    if (!channels[alias]) flag(`agent ${slug}`, `reportsTo "${alias}" is not a channel in config/channels.yaml`);
  }
  if ((a.reportsTo ?? []).length && gatewayOn && callers[caller] && !(callers[caller].allow ?? []).some((g) => g === "*" || g === "post_report")) {
    warn(`agent ${slug}`, `has reportsTo but callers.${caller} doesn't allow post_report`);
  }
  if (a.crossPostChannels) flag(`agent ${slug}`, "crossPostChannels was replaced by reportsTo + config/channels.yaml");
  for (const [repoName, v] of Object.entries(a.workRepos ?? {})) {
    const p = typeof v === "string" ? v : v?.path;
    if (!p) flag(`agent ${slug}`, `workRepos.${repoName} has no path`);
    else if (p.startsWith("/") || p.includes("..")) flag(`agent ${slug}`, `workRepos.${repoName}.path must be relative to the repo root, without ..`);
    if (typeof v === "object" && v.autoMerge && !v.repo) flag(`agent ${slug}`, `workRepos.${repoName} has autoMerge but no repo ("owner/name")`);
  }
}

// ---- automations ----
for (const [name, a] of Object.entries(automations)) {
  const where = `automation ${name}`;
  if (!a?.prompt_file) flag(where, "missing prompt_file");
  else if (!exists(a.prompt_file)) flag(where, `prompt_file does not exist: ${a.prompt_file}`);
  for (const field of ["max_runtime", "max_runs_per_day", "max_turns"]) {
    if (typeof a?.[field] !== "number") flag(where, `missing or non-numeric ${field}`);
  }
  const tools = a?.allowed_tools ?? [];
  for (const t of tools) {
    if (typeof t !== "string" || !/^[A-Za-z_][\w-]*(\(.+\))?$/.test(t)) flag(where, `malformed allowed_tools entry: ${JSON.stringify(t)}`);
  }
  const skills = a?.skills ?? [];
  if (skills.length && !tools.includes("Skill")) flag(where, `lists skills but does not grant "Skill"`);
  for (const s of skills) if (!exists(`.claude/skills/${s}/SKILL.md`)) flag(where, `skill not found: .claude/skills/${s}/SKILL.md`);
  if (gatewayOn && tools.some((t) => t === "mcp__gateway" || t.startsWith("mcp__gateway__")) && !callers[name]) {
    warn(where, `grants the gateway but config/gateway.yaml has no callers.${name}: it will see no gateway tools`);
  }
  if (a?.slack) flag(where, "the `slack:` block was replaced by `report: {as, to}`");
  if (a?.report) {
    if (!agents[a.report.as]) flag(where, `report.as "${a.report.as}" is not an agent in agents/agents.json`);
    for (const t of [].concat(a.report.to ?? [])) if (!channels[t]) flag(where, `report.to "${t}" is not a channel in config/channels.yaml`);
    if (gatewayOn && !(callers[name]?.allow ?? []).some((g) => g === "*" || g === "post_report")) flag(where, `has a report target but callers.${name} doesn't allow post_report`);
    if (!tools.includes("mcp__gateway")) flag(where, `has a report target but doesn't grant "mcp__gateway"`);
  }
  for (const slot of a?.schedule ?? []) {
    const ok = slot && Number.isInteger(slot.hour) && slot.hour >= 0 && slot.hour <= 23 &&
      Number.isInteger(slot.minute) && slot.minute >= 0 && slot.minute <= 59 &&
      (slot.weekday === undefined || (Number.isInteger(slot.weekday) && slot.weekday >= 0 && slot.weekday <= 6));
    if (!ok) flag(where, `bad schedule entry ${JSON.stringify(slot)}: want {hour 0-23, minute 0-59, weekday? 0-6}`);
  }

  // Drift check: every `git <sub>` in backticks in the prompt must be granted.
  if (a?.prompt_file && exists(a.prompt_file)) {
    const prompt = fs.readFileSync(path.join(ROOT, a.prompt_file), "utf8");
    const subs = new Set([...prompt.matchAll(/`git\s+([a-z][a-z-]*)[^`]*`/g)].map((m) => m[1]));
    for (const sub of subs) {
      const granted = tools.some((t) => t === "Bash" || t.startsWith(`Bash(git ${sub}`) || t === "Bash(git:*)");
      if (!granted) flag(where, `prompt instructs \`git ${sub}\` but allowed_tools has no Bash(git ${sub}:*)`);
    }
  }
}

// Generated subagents (gitignored, per machine): warn when they're stale.
if (exists(".claude/agents")) {
  const r = spawnSync(process.execPath, [path.join(ROOT, "scripts", "agents-sync.mjs"), "--check"], { encoding: "utf8" });
  if (r.status !== 0) warn("subagents", "files in .claude/agents are out of date; run npm run agents:sync");
}

for (const w of warnings) console.warn(`warn  ${w}`);
if (problems.length) {
  for (const p of problems) console.error(`FAIL  ${p}`);
  console.error(`\n${problems.length} problem(s). Fix them before running anything.`);
  process.exit(1);
}
console.log(`preflight ok: ${Object.keys(agents).length} agent(s), ${Object.keys(automations).length} automation(s), gateway ${gatewayOn ? `on (${Object.keys(callers).length} callers)` : "off"}`);
