/**
 * Gateway configuration: config/gateway.yaml (upstreams, structural rules,
 * per-caller allowlists) and automations/automations.yaml (which automations
 * an agent may trigger). Read fresh on each Policy construction.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

export const ROOT =
  process.env.AGENTS_ROOT ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export function loadGatewayConfig() {
  const file = process.env.AGENTS_GATEWAY_CONFIG ?? path.join(ROOT, "config", "gateway.yaml");
  try {
    return parse(readFileSync(file, "utf8")) ?? {};
  } catch (e) {
    console.error(`[gateway] cannot read ${file}: ${e.message} — interactive sessions get local tools only, every other caller gets nothing`);
    return {};
  }
}

/** Names of automations with `agent_triggerable: true`. */
export function agentTriggerable() {
  try {
    const doc = parse(readFileSync(path.join(ROOT, "automations", "automations.yaml"), "utf8")) ?? {};
    return new Set(
      Object.entries(doc.automations ?? {})
        .filter(([, a]) => a?.agent_triggerable === true)
        .map(([name]) => name)
    );
  } catch {
    return new Set();
  }
}

/** Replace ${VAR} with process.env.VAR (empty string if unset). */
export function interpolateEnv(value) {
  return String(value).replace(/\$\{([A-Z0-9_]+)\}/g, (_, k) => process.env[k] ?? "");
}

/** Load the repo's .env into process.env (existing values win). The gateway
 * can be spawned by an interactive session that never sourced it. */
export function loadDotEnv() {
  const file = process.env.AGENTS_ENV_FILE ?? path.join(ROOT, ".env");
  let raw = "";
  try { raw = readFileSync(file, "utf8"); } catch { return; }
  for (const line of raw.split("\n")) {
    const s = line.trim();
    if (!s || s.startsWith("#")) continue;
    const eq = s.indexOf("=");
    if (eq < 0) continue;
    const k = s.slice(0, eq).trim().replace(/^export\s+/, "");
    let v = s.slice(eq + 1).trim();
    if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) v = v.slice(1, -1);
    if (process.env[k] === undefined) process.env[k] = v;
  }
}
