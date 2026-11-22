#!/usr/bin/env node
/**
 * ask.mjs <agent-slug> "<request>" [--in <folder>] [--allow-edits] [--show-prompt]
 *
 * Run ONE agent turn from your terminal: the same persona, memory, knowledge
 * base, tool allowlist and gateway it has everywhere else. The reply prints
 * to stdout.
 *
 *   npm run ask -- scout "What plans do we sell?"
 *   npm run ask -- scout "Review this README" --in ~/code/my-app
 *   npm run ask -- quill "Tighten the landing copy" --in ~/code/site --allow-edits
 *   npm run ask -- scout "anything" --show-prompt    # print the prompt and tools, run nothing
 *
 * --in          work inside another project folder. The agent can read that
 *               folder AND its home in this repo (knowledge base, memory, skills).
 * --allow-edits let the agent change files inside the --in folder (or this repo).
 */
import path from "node:path";
import os from "node:os";
import { ROOT, loadSharedEnv, resolveAgent, loadAgents, warnIfNoApiKey } from "../core/config.mjs";
import { buildSystem, buildAllowedTools, chooseModelAlias } from "../core/prompt.mjs";
import { runClaude, LOCAL_RULES } from "../core/run.mjs";

const argv = process.argv.slice(2);
const flag = (f) => { const i = argv.indexOf(f); if (i < 0) return false; argv.splice(i, 1); return true; };
const opt = (f) => { const i = argv.indexOf(f); if (i < 0) return null; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const showPrompt = flag("--show-prompt");
const allowEdits = flag("--allow-edits");
const inDir = opt("--in");
const [slug, ...rest] = argv;
const request = rest.join(" ").trim();

if (!slug || !request) {
  console.error('usage: npm run ask -- <agent-slug> "<request>" [--in <folder>] [--allow-edits] [--show-prompt]');
  console.error(`agents: ${Object.keys(loadAgents()).join(", ") || "(none in agents/agents.json)"}`);
  process.exit(2);
}

loadSharedEnv();
const agent = resolveAgent(slug);
if (!agent) {
  console.error(`unknown agent "${slug}". agents: ${Object.keys(loadAgents()).join(", ")}`);
  process.exit(2);
}

const cwd = inDir ? path.resolve(inDir.replace(/^~(?=\/|$)/, os.homedir())) : ROOT;
const elsewhere = cwd !== ROOT;
const system = buildSystem(agent, { surfaceRules: LOCAL_RULES, home: elsewhere ? ROOT : null });
if (showPrompt) {
  console.log(`# caller: ${agent.caller}\n# cwd: ${cwd}\n# model: ${chooseModelAlias(agent, request)}\n# allowedTools: ${buildAllowedTools(agent, { home: elsewhere ? ROOT : null, allowEdits })}\n\n${system}`);
  process.exit(0);
}

warnIfNoApiKey("ask");
console.error(`[ask] ${agent.name} (${chooseModelAlias(agent, request)})${elsewhere ? ` in ${cwd}` : ""} is working…`);
const r = await runClaude({ agent, prompt: request, system, surface: "cli", cwd, allowEdits, onPhase: (p) => console.error(`[ask] …${p}`) });
if (!r.ok) {
  console.error(`[ask] turn failed: ${r.reason}`);
  if (r.stderr) console.error(r.stderr.slice(-800));
  process.exit(1);
}
console.log(r.text);
if (typeof r.costUsd === "number") console.error(`[ask] cost $${r.costUsd.toFixed(4)}`);
process.exit(0);
