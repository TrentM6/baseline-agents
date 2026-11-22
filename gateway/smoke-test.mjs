#!/usr/bin/env node
/**
 * smoke-test.mjs [caller] — boot the real gateway over stdio as a caller, list
 * what it can see, and make one kb_search call. Proves the gateway starts and
 * the allowlist for that caller is what you expect.
 *
 *   npm run smoke-test                # as slack-scout
 *   npm run smoke-test -- session     # as the interactive session
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const caller = process.argv[2] || "slack-scout";

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(ROOT, "gateway/src/index.mjs")],
  env: { ...process.env, AGENTS_CALLER: caller, AGENTS_ROOT: ROOT },
  stderr: "inherit",
});
const client = new Client({ name: "smoke-test", version: "0.1.0" });
await client.connect(transport);

const { tools } = await client.listTools();
console.log(`caller ${caller} sees ${tools.length} tool(s): ${tools.map((t) => t.name).join(", ") || "(none)"}`);

if (tools.some((t) => t.name === "kb_search")) {
  const r = await client.callTool({ name: "kb_search", arguments: { query: "pricing" } });
  console.log(`kb_search "pricing" →\n${r.content?.[0]?.text}`);
}
const denied = await client.callTool({ name: "write_file", arguments: { path: "config/gateway.yaml", content: "x" } });
console.log(`write_file config/gateway.yaml → ${denied.content?.[0]?.text}`);

await client.close();
process.exit(0);
