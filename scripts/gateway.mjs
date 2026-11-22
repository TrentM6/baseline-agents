#!/usr/bin/env node
/**
 * gateway.mjs on | off | status
 *
 * The gateway is optional. Turn it on when you want a safety layer between
 * your agents and their tools: per-agent allowlists, tools nobody can use,
 * a log of every call, and the post_report tool. Recommended for anything
 * that runs unattended (schedules, Slack).
 *
 *   npm run gateway:on      copy config/gateway.example.yaml → config/gateway.yaml
 *                           (if you don't have one) and write .mcp.json so
 *                           Claude Code sessions in this repo use it too
 *   npm run gateway:off     move config/gateway.yaml aside and remove .mcp.json
 *   npm run gateway:status
 *
 * After switching, run `npm run agents:sync` so your subagents match.
 */
import fs from "node:fs";
import path from "node:path";
import { ROOT, GATEWAY_FILE, gatewayEnabled } from "../core/config.mjs";
import { gatewayMcpConfig } from "../core/run.mjs";

const EXAMPLE = path.join(ROOT, "config", "gateway.example.yaml");
const PARKED = path.join(ROOT, "config", "gateway.off.yaml");
const MCP_JSON = path.join(ROOT, ".mcp.json");
const mode = process.argv[2] || "status";

if (mode === "on") {
  if (!fs.existsSync(GATEWAY_FILE)) {
    fs.copyFileSync(fs.existsSync(PARKED) ? PARKED : EXAMPLE, GATEWAY_FILE);
    if (fs.existsSync(PARKED)) fs.rmSync(PARKED);
    console.log(`  wrote config/gateway.yaml`);
  }
  fs.writeFileSync(MCP_JSON, JSON.stringify(JSON.parse(gatewayMcpConfig()), null, 2) + "\n");
  console.log("  wrote .mcp.json (Claude Code sessions in this repo now load the gateway)");
  console.log("Gateway ON. Next: edit config/gateway.yaml, then npm run scope-test and npm run agents:sync.");
} else if (mode === "off") {
  if (fs.existsSync(GATEWAY_FILE)) { fs.renameSync(GATEWAY_FILE, PARKED); console.log("  moved config/gateway.yaml → config/gateway.off.yaml"); }
  if (fs.existsSync(MCP_JSON)) { fs.rmSync(MCP_JSON); console.log("  removed .mcp.json"); }
  console.log("Gateway OFF. Agents use Claude Code's own tools, limited by their allowlist. Run npm run agents:sync.");
} else if (mode === "status") {
  console.log(`Gateway is ${gatewayEnabled() ? "ON (config/gateway.yaml)" : "OFF"}${process.env.AGENTS_GATEWAY === "off" ? " (forced off by AGENTS_GATEWAY=off)" : ""}.`);
} else {
  console.error("usage: node scripts/gateway.mjs on | off | status");
  process.exit(2);
}
