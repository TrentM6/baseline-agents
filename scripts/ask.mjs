#!/usr/bin/env node
/**
 * ask.mjs <agent-slug> "<question>" [--show-prompt]
 *
 * Run ONE agent turn locally, without Slack: same persona, memory, KB map,
 * tool allowlist, and gateway as a Slack turn. The reply prints to stdout.
 * Use it to try an agent before wiring Slack, and after every persona or
 * permission change.
 *
 *   npm run ask -- scout "What plans do we sell?"
 *   npm run ask -- scout "anything" --show-prompt   # print the system prompt and tools, run nothing
 */
import { loadSharedEnv, resolveAgent, loadAgents, warnIfNoApiKey } from "../slack/config.mjs";
import { buildSystem, buildAllowedTools, runClaude, stripSentinel, chooseModelAlias } from "../slack/runner.mjs";

const [slug, ...rest] = process.argv.slice(2);
const showPrompt = rest.includes("--show-prompt");
const question = rest.filter((a) => a !== "--show-prompt").join(" ").trim();

if (!slug || !question) {
  console.error('usage: node scripts/ask.mjs <agent-slug> "<question>" [--show-prompt]');
  console.error(`agents: ${Object.keys(loadAgents()).join(", ") || "(none in agents/agents.json)"}`);
  process.exit(2);
}

loadSharedEnv();
const agent = resolveAgent(slug);
if (!agent) {
  console.error(`unknown agent "${slug}". agents: ${Object.keys(loadAgents()).join(", ")}`);
  process.exit(2);
}

const system = buildSystem(agent, false);
if (showPrompt) {
  console.log(`# caller: ${agent.caller}\n# model: ${chooseModelAlias(agent, question)}\n# allowedTools: ${buildAllowedTools(agent)}\n\n${system}`);
  process.exit(0);
}

warnIfNoApiKey("ask");
console.error(`[ask] ${agent.name} (${chooseModelAlias(agent, question)}) is thinking…`);
const r = await runClaude({
  agent,
  prompt: question,
  system,
  resumeId: null,
  source: "cli",
  onPhase: (p) => console.error(`[ask] …${p}`),
});
if (!r.ok) {
  console.error(`[ask] turn failed: ${r.reason}`);
  if (r.stderr) console.error(r.stderr.slice(-800));
  process.exit(1);
}
console.log(stripSentinel(r.text) || "(the agent chose not to reply)");
if (typeof r.costUsd === "number") console.error(`[ask] cost $${r.costUsd.toFixed(4)}`);
process.exit(0);
