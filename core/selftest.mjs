// selftest.mjs: offline checks of the agent core and the surfaces built on it.
// No Slack, no Claude, no cost. Runs with the gateway OFF (the default) and
// then ON (against config/gateway.example.yaml).
//
//   node core/selftest.mjs
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

process.env.AGENTS_GATEWAY = "off";
const EXAMPLE = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "config", "gateway.example.yaml");
const { ROOT, resolveAgent } = await import("./config.mjs");
const { buildSystem, buildAllowedTools, BASE_TOOLS } = await import("./prompt.mjs");
const { mcpArgs, LOCAL_RULES, gatewayMcpConfig } = await import("./run.mjs");
const { slackRules } = await import("../slack/turn.mjs");

let failures = 0;
const check = (name, cond, detail = "") => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.error(`  FAIL ${name}${detail ? `: ${detail}` : ""}`); }
};

const scout = resolveAgent("scout");
console.log("Standalone (no gateway, no Slack):");
{
  check("no MCP args: Claude Code's own config applies", mcpArgs().length === 0);
  check("tools = repo-scoped file tools + skills", buildAllowedTools(scout) === BASE_TOOLS.join(",") && !buildAllowedTools(scout).includes("mcp__gateway"));
  const withTools = { ...scout, tools: ["WebSearch", "Bash(npm test:*)"] };
  check("an agent's own `tools` are granted as written", buildAllowedTools(withTools).endsWith("WebSearch,Bash(npm test:*)"));
  const sys = buildSystem(scout, { surfaceRules: LOCAL_RULES });
  check("no gateway-only instructions in the prompt", !sys.includes("post_report") && !sys.includes("trigger_automation") && !sys.includes("mcp__gateway"));
  check("knowledge base, memory and persona still present", sys.includes("KB MAP") && sys.includes("YOUR MEMORY") && sys.startsWith("You are Scout"));
}

console.log("\nAgent definition is surface-independent:");
{
  const local = buildSystem(scout, { surfaceRules: LOCAL_RULES });
  const slack = buildSystem(scout, { surfaceRules: slackRules(false), mentions: true });
  const persona = local.split("\n\n")[0];
  check("same persona on every surface", slack.startsWith(persona) && persona.length > 50);
  check("memory loaded on every surface", local.includes("YOUR MEMORY") && slack.includes("YOUR MEMORY"));
  check("KB map on every surface", local.includes("KB MAP") && slack.includes("KB MAP"));
  check("Slack etiquette only on Slack", slack.includes("replying inside Slack") && !local.includes("replying inside Slack"));
  check("same tools on Slack and CLI (in the repo)", buildAllowedTools(scout) === BASE_TOOLS.join(","));
  check("no Slack mention syntax outside Slack", !local.includes("<@") );
}

console.log("\nRunning in another folder:");
{
  const elsewhere = buildAllowedTools(scout, { home: ROOT });
  check("reads its home repo by absolute path", elsewhere.includes(`Read(/${ROOT}/**)`));
  check("no edits unless asked", !elsewhere.includes("Edit("));
  check("--allow-edits grants edits in the working folder only", buildAllowedTools(scout, { home: ROOT, allowEdits: true }).includes("Edit(./**)"));
  const sys = buildSystem(scout, { surfaceRules: LOCAL_RULES, home: ROOT });
  check("prompt tells it where home is", sys.includes(`agents repo at ${ROOT}`) && sys.includes(".claude/skills/<name>/SKILL.md"));
  const worker = { ...scout, workRepos: { site: { path: "workspaces/site" } } };
  check("repo-work grants dropped outside the agents repo", !buildAllowedTools(worker, { home: ROOT }).includes("git -C"));
}

console.log("\nWith the gateway on:");
delete process.env.AGENTS_GATEWAY;
process.env.AGENTS_GATEWAY_CONFIG = EXAMPLE;
{
  check("gateway is the only MCP server, with absolute paths", mcpArgs().includes("--strict-mcp-config") && path.isAbsolute(JSON.parse(gatewayMcpConfig()).mcpServers.gateway.args[0]));
  check("mcp__gateway granted", buildAllowedTools(scout).includes("mcp__gateway"));
  const sys = buildSystem(scout, { surfaceRules: LOCAL_RULES });
  check("report channels and ops rules appear", sys.includes("=== REPORTING ===") && sys.includes("trigger_automation"));
}
async function gatewayAs(caller) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(ROOT, "gateway", "src", "index.mjs")],
    env: { ...process.env, AGENTS_CALLER: caller, AGENTS_ROOT: ROOT, AGENTS_GATEWAY_CONFIG: EXAMPLE, AGENTS_REPORT_DRY_RUN: "1" },
    stderr: "ignore",
  });
  const client = new Client({ name: "core-selftest", version: "0.1.0" });
  await client.connect(transport);
  return client;
}
const report = async (client, args) => (await client.callTool({ name: "post_report", arguments: args })).content?.[0]?.text ?? "";
{
  const agent = await gatewayAs("agent-scout");
  check("agent posts to its own channel", (await report(agent, { to: "general", text: "hi" })).startsWith("Dry run"));
  check("agent can't post to a channel outside reportsTo", (await report(agent, { to: "digest", text: "hi" })).includes("may not post"));
  check("agent can't post as someone else", (await report(agent, { to: "general", text: "hi", as: "other" })).includes("may only post as"));
  await agent.close();

  const session = await gatewayAs("session");
  check("session must name who is posting", (await report(session, { to: "general", text: "hi" })).includes('pass "as"'));
  check("session (a subagent) posts as the named agent", (await report(session, { to: "general", text: "hi", as: "scout" })).startsWith("Dry run"));
  await session.close();

  const auto = await gatewayAs("kb-digest");
  check("automation posts to its report.to", (await report(auto, { to: "digest", text: "hi" })).startsWith("Dry run"));
  check("automation can't post elsewhere", (await report(auto, { to: "general", text: "hi" })).includes("may not post"));
  await auto.close();

  const tools = (await (await gatewayAs("session")).listTools()).tools.map((t) => t.name);
  check("second_opinion is off by default", !tools.includes("second_opinion"));

  const stranger = await gatewayAs("not-a-caller");
  check("unknown caller can't post at all", (await report(stranger, { to: "general", text: "hi", as: "scout" })).includes("not allowed"));
  await stranger.close();
}

if (failures) { console.error(`\n${failures} check(s) FAILED`); process.exit(1); }
console.log("\nall core checks passed");
process.exit(0);
