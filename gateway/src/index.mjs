#!/usr/bin/env node
/**
 * The MCP gateway (stdio): ONE doorway between your agents and every external
 * tool. Claude Code spawns it from .mcp.json. It wraps the upstream MCP servers
 * in config/gateway.yaml plus the local tools (KB, skills, automations, repo
 * files) behind per-caller allowlists, structural hard-denies, and a call log
 * (logs/toolcalls.jsonl).
 *
 * Caller identity = AGENTS_CALLER (an agent's turn sets agent-<slug>, an
 * automation sets its own name). Unset = "session", the
 * interactive human at a terminal.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer, startUpstreams, shutdownUpstreams } from "./server.mjs";
import { loadDotEnv } from "./config.mjs";

loadDotEnv();

const CALLER = process.env.AGENTS_CALLER || "session";

// Connect upstreams in the BACKGROUND so initialize answers instantly.
const upstreams = startUpstreams(CALLER);
const server = createServer({ caller: CALLER, upstreams });

async function shutdown() {
  await shutdownUpstreams(upstreams);
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
process.stdin.on("close", shutdown);

await server.connect(new StdioServerTransport());
