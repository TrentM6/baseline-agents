/**
 * The gateway MCP server, transport-agnostic. index.mjs serves it over stdio
 * (what Claude Code spawns from .mcp.json). Another transport would build the
 * server here too, so the tool list and policy can never diverge between them.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { connectUpstreams, closeUpstreams } from "./upstreams.mjs";
import { Policy } from "./policy.mjs";
import { secondOpinionTool } from "./second-opinion.mjs";
import { executeTool } from "./execute-tool.mjs";
import { LOCAL_TOOLS } from "./local-tools.mjs";
import { ROOT } from "./config.mjs";

const TOOLS_CACHE = path.join(ROOT, "logs", "gateway-tools-cache.json");

// The client asks for the tool list right after initialize. Waiting on every
// upstream handshake there adds seconds per turn, and one slow upstream can
// blow the client's startup timeout so the agent gets NO tools. So list from
// the last boot's cache while upstreams connect; actual CALLS still await the
// live upstreams, so a stale entry fails one call loudly instead of hiding.
function readToolsCache(caller) {
  try {
    const entry = JSON.parse(readFileSync(TOOLS_CACHE, "utf8"))[caller];
    if (entry && Array.isArray(entry.tools) && entry.tools.length) return entry.tools;
  } catch {}
  return null;
}
function writeToolsCache(caller, tools) {
  try {
    let all = {};
    try { all = JSON.parse(readFileSync(TOOLS_CACHE, "utf8")); } catch {}
    all[caller] = { ts: new Date().toISOString(), tools };
    mkdirSync(path.dirname(TOOLS_CACHE), { recursive: true });
    writeFileSync(TOOLS_CACHE, JSON.stringify(all));
  } catch {}
}

/** Connect upstreams once per process; returns a handle every server shares. */
export function startUpstreams(caller) {
  const state = { resolved: false };
  state.ready = connectUpstreams().then(({ clients, tools }) => {
    const allTools = [...tools, ...(process.env.OPENROUTER_API_KEY ? [secondOpinionTool] : []), ...LOCAL_TOOLS];
    const visible = new Policy().filterTools(caller, allTools);
    console.error(`[gateway] caller=${caller} tools=${visible.length}/${allTools.length}`);
    writeToolsCache(caller, visible);
    state.resolved = true;
    return { clients, allTools };
  });
  return state;
}

export function createServer({ caller, upstreams, policy = new Policy() }) {
  const server = new Server({ name: "agents-gateway", version: "0.1.0" }, { capabilities: { tools: {} } });
  const cachedTools = readToolsCache(caller);

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    if (!upstreams.resolved && cachedTools) return { tools: cachedTools };
    const { allTools } = await upstreams.ready;
    const visible = policy.filterTools(caller, allTools);
    writeToolsCache(caller, visible);
    return { tools: visible };
  });

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    const { clients } = await upstreams.ready;
    return executeTool({ caller, name, args, clients, policy });
  });

  return server;
}

export async function shutdownUpstreams(upstreams) {
  try {
    const { clients } = await upstreams.ready;
    await closeUpstreams(clients);
  } catch {}
}
