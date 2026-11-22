import { createHash } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ROOT, loadGatewayConfig, interpolateEnv } from "./config.mjs";

const CONNECT_TIMEOUT_MS = 30_000;

/**
 * Has this mcp-remote (OAuth) upstream already completed its one-time login?
 *
 * Without this gate, an OAuth upstream with no cached token opens a browser
 * tab on EVERY gateway spawn, and the gateway spawns per agent turn. The
 * 30s connect timeout is also shorter than a human consent flow, so the
 * token never gets saved and the tab storm never ends. Authorize once
 * interactively (run the upstream's command by hand), then it loads normally.
 * mcp-remote keys its files by md5 of the server URL under ~/.mcp-auth/.
 */
function hasOAuthToken(url) {
  const root = join(homedir(), ".mcp-auth");
  if (!existsSync(root)) return false;
  const hash = createHash("md5").update(url).digest("hex");
  let dirs = [];
  try {
    dirs = readdirSync(root).filter((d) => d.startsWith("mcp-remote-"));
  } catch {
    return false;
  }
  return dirs.some((d) => existsSync(join(root, d, `${hash}_tokens.json`)));
}

/**
 * Upstream MCP servers, from config/gateway.yaml → upstreams. Each entry:
 *   prefix:   namespace for its tools (github → github_create_pull_request)
 *   command:  executable; "node" means the node running this gateway
 *   args:     list; "./..." paths resolve against the repo root
 *   env:      map; ${VAR} is replaced from the environment
 *   oauth_url: optional; skip until ~/.mcp-auth holds a token for this URL
 *
 * Prefer installing an upstream as a dependency and running it with node
 * directly over `npx`: npx re-checks the registry on every spawn, which hangs
 * when the network isn't up yet (right after a laptop wakes) and takes the
 * whole gateway's tool list with it.
 */
function definitions() {
  const list = loadGatewayConfig().upstreams ?? [];
  return list
    .filter((u) => u && u.prefix && u.command && u.enabled !== false)
    .map((u) => ({
      prefix: String(u.prefix),
      command: u.command === "node" ? process.execPath : String(u.command),
      args: (u.args ?? []).map((a) => {
        const v = interpolateEnv(a);
        return v.startsWith("./") ? join(ROOT, v) : v;
      }),
      env: Object.fromEntries(Object.entries(u.env ?? {}).map(([k, v]) => [k, interpolateEnv(v)])),
      oauthUrl: u.oauth_url ?? null,
    }));
}

/**
 * Connect all upstreams. Returns { clients, tools } where tools carry
 * namespaced names (<prefix>_<original>). A failed upstream logs to stderr and
 * is skipped: the gateway serves whatever connected.
 */
export async function connectUpstreams() {
  const clients = new Map();
  const tools = [];
  const defs = definitions().filter((def) => {
    if (!def.oauthUrl || hasOAuthToken(def.oauthUrl)) return true;
    console.error(`[gateway] skipping "${def.prefix}": no cached OAuth token; authorize it once interactively`);
    return false;
  });

  await Promise.all(
    defs.map(async (def) => {
      try {
        const transport = new StdioClientTransport({
          command: def.command,
          args: def.args,
          env: { ...process.env, ...def.env },
          stderr: "ignore",
        });
        const client = new Client({ name: `gateway-${def.prefix}`, version: "0.1.0" });
        await withTimeout(client.connect(transport), CONNECT_TIMEOUT_MS, `${def.prefix} connect`);
        const { tools: upstreamTools } = await withTimeout(client.listTools(), CONNECT_TIMEOUT_MS, `${def.prefix} listTools`);
        const toolNames = new Map();
        for (const t of upstreamTools) {
          const namespaced = `${def.prefix}_${t.name}`;
          toolNames.set(namespaced, t.name);
          tools.push({ ...t, name: namespaced });
        }
        clients.set(def.prefix, { client, toolNames });
        console.error(`[gateway] ${def.prefix}: ${upstreamTools.length} tools`);
      } catch (e) {
        console.error(`[gateway] ${def.prefix} unavailable: ${String(e).slice(0, 200)}`);
      }
    })
  );
  return { clients, tools };
}

export async function callUpstream(clients, namespacedName, args) {
  for (const [prefix, entry] of clients) {
    if (!namespacedName.startsWith(prefix + "_")) continue;
    const original = entry.toolNames.get(namespacedName);
    if (original) return entry.client.callTool({ name: original, arguments: args ?? {} });
  }
  throw new Error(`no connected upstream serves ${namespacedName}`);
}

export async function closeUpstreams(clients) {
  await Promise.allSettled([...clients.values()].map(({ client }) => client.close()));
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout: ${label}`)), ms).unref?.()),
  ]);
}
