// selftest.mjs: offline checks of the agent core and the surfaces built on it.
// No Slack, no Claude, no cost.
//
//   node core/selftest.mjs
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ROOT, resolveAgent } from "./config.mjs";
import { buildSystem, buildAllowedTools, BASE_TOOLS } from "./prompt.mjs";
import { gatewayMcpConfig, LOCAL_RULES } from "./run.mjs";
import { slackRules } from "../slack/turn.mjs";

let failures = 0;
const check = (name, cond, detail = "") => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.error(`  FAIL ${name}${detail ? `: ${detail}` : ""}`); }
};

const scout = resolveAgent("scout");
console.log("Agent definition is surface-independent:");
{
  const local = buildSystem(scout, { surfaceRules: LOCAL_RULES });
  const slack = buildSystem(scout, { surfaceRules: slackRules(false), mentions: true });
  const persona = local.split("\n\n")[0];
  check("same persona on every surface", slack.startsWith(persona) && persona.length > 50);
  check("memory loaded on every surface", local.includes("YOUR MEMORY") && slack.includes("YOUR MEMORY"));
  check("KB map on every surface", local.includes("KB MAP") && slack.includes("KB MAP"));
  check("report channels on every surface", local.includes("=== REPORTING ===") && slack.includes("=== REPORTING ==="));
  check("Slack etiquette only on Slack", slack.includes("replying inside Slack") && !local.includes("replying inside Slack"));
  check("same tools on Slack and CLI (in the repo)", buildAllowedTools(scout) === BASE_TOOLS.join(","));
}

console.log("\nRunning in another folder:");
{
  const elsewhere = buildAllowedTools(scout, { home: ROOT });
  check("reads its home repo by absolute path", elsewhere.includes(`Read(/${ROOT}/**)`));
  check("no edits unless asked", !elsewhere.includes("Edit("));
  check("--allow-edits grants edits in the working folder only", buildAllowedTools(scout, { home: ROOT, allowEdits: true }).includes("Edit(./**)"));
  const sys = buildSystem(scout, { surfaceRules: LOCAL_RULES, home: ROOT });
  check("prompt tells it where home is", sys.includes(`agents repo at ${ROOT}`));
  const mcp = JSON.parse(gatewayMcpConfig()).mcpServers.gateway;
  check("gateway path is absolute", path.isAbsolute(mcp.args[0]) && mcp.env.AGENTS_ROOT === ROOT);
  const worker = { ...scout, workRepos: { site: { path: "workspaces/site" } } };
  check("repo-work grants dropped outside the agents repo", !buildAllowedTools(worker, { home: ROOT }).includes("git -C"));
}

console.log("\nReporting through the gateway (dry run):");
async function gatewayAs(caller) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(ROOT, "gateway", "src", "index.mjs")],
    env: { ...process.env, AGENTS_CALLER: caller, AGENTS_ROOT: ROOT, AGENTS_REPORT_DRY_RUN: "1" },
    stderr: "ignore",
  });
  const client = new Client({ name: "core-selftest", version: "0.1.0" });
  await client.connect(transport);
  return client;
}
const report = async (client, args) => (await client.callTool({ name: "post_report", arguments: args })).content?.[0]?.text ?? "";
{
  const agent = await gatewayAs("slack-scout");
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

  const stranger = await gatewayAs("not-a-caller");
  check("unknown caller can't post at all", (await report(stranger, { to: "general", text: "hi", as: "scout" })).includes("not allowed"));
  await stranger.close();
}

if (failures) { console.error(`\n${failures} check(s) FAILED`); process.exit(1); }
console.log("\nall core checks passed");
process.exit(0);
