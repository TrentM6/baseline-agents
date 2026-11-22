// The agent core, for any surface that wants to run agents:
//
//   import { runAgent } from "<agents repo>/core/index.mjs";
//   const r = await runAgent({ slug: "scout", prompt: "What plans do we sell?" });
//   console.log(r.ok ? r.text : r.reason);
//
// Pass `cwd` to have the agent work inside another project folder, and
// `allowEdits: true` to let it change files there.
export { ROOT, loadAgents, resolveAgent, roster, loadChannels, loadSharedEnv, warnIfNoApiKey } from "./config.mjs";
export { buildSystem, buildAllowedTools, loadMemory, chooseModelAlias, BASE_TOOLS, GROUNDING_RULES } from "./prompt.mjs";
export { runClaude, runAgent, LOCAL_RULES, gatewayMcpConfig } from "./run.mjs";
export { kbMap } from "./kb.mjs";
