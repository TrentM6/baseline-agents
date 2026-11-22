#!/usr/bin/env node
/**
 * scope-test.mjs: prove the gateway's permission model does what you think.
 *
 * Part 1 runs fixed cases against a built-in fixture config, so the guards
 * themselves are tested no matter what your config says.
 * Part 2 loads YOUR config/gateway.yaml and checks invariants that must hold
 * for any sane setup (unknown callers see nothing, hard-denies hold for
 * everyone, agents can't reach session-only tools).
 *
 *   npm run scope-test
 */
import { Policy } from "./src/policy.mjs";
import { existsSync } from "node:fs";
import path from "node:path";
import { ROOT, loadGatewayConfig } from "./src/config.mjs";

let failures = 0;
const check = (name, cond, detail = "") => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.error(`  FAIL ${name}${detail ? `: ${detail}` : ""}`); }
};

console.log("Guards (fixture config):");
const fixture = new Policy({
  hard_deny: ["*_send_*", "github_merge_*"],
  read_only: { bank: "^bank_(get|list)_" },
  session_only: ["browser"],
  github: { owner: "acme", repo_allowlist: ["acme/site"] },
  callers: {
    session: { allow: ["*"] },
    "slack-writer": { allow: ["github_*", "bank_*", "browser_*", "mail_*", "trigger_automation"] },
  },
});
check("hard_deny holds for session", !fixture.allowed("session", "mail_send_message"));
check("hard_deny holds for an agent granted mail_*", !fixture.allowed("slack-writer", "mail_send_message"));
check("non-denied tool under a granted glob is allowed", fixture.allowed("slack-writer", "mail_create_draft"));
check("github_merge_* denied even with github_* granted", !fixture.allowed("slack-writer", "github_merge_pull_request"));
check("read_only upstream: read tool allowed", fixture.allowed("slack-writer", "bank_get_balance"));
check("read_only upstream: write tool denied", !fixture.allowed("slack-writer", "bank_create_transfer"));
check("read_only upstream: write tool denied for session too", !fixture.allowed("session", "bank_create_transfer"));
check("session_only prefix hidden from agents", !fixture.allowed("slack-writer", "browser_click"));
check("session_only prefix visible to session", fixture.allowed("session", "browser_click"));
check("unknown caller sees nothing", !fixture.allowed("slack-stranger", "kb_search"));
check("github: allowlisted repo passes", fixture.scopeViolation("github_get_file_contents", { owner: "acme", repo: "site" }) === null);
check("github: other repo under owner denied", fixture.scopeViolation("github_get_file_contents", { owner: "acme", repo: "secret" }) !== null);
check("github: other owner denied", fixture.scopeViolation("github_get_file_contents", { owner: "someone-else", repo: "site" }) !== null);
check("github: account-wide search denied", fixture.scopeViolation("github_search_code", { query: "password" }) !== null);
check("github: create repo under owner allowed", fixture.scopeViolation("github_create_repository", { name: "new" }) === null);
check("github: create repo under another org denied", fixture.scopeViolation("github_create_repository", { name: "new", owner: "other-org" }) !== null);
check("trigger_automation: unknown automation denied", fixture.scopeViolation("trigger_automation", { name: "no-such-automation" }) !== null);

// Your config if the gateway is on, otherwise the example you'd start from.
const own = path.join(ROOT, "config", "gateway.yaml");
if (!process.env.AGENTS_GATEWAY_CONFIG && !existsSync(own)) process.env.AGENTS_GATEWAY_CONFIG = path.join(ROOT, "config", "gateway.example.yaml");
console.log(`\n${path.relative(ROOT, process.env.AGENTS_GATEWAY_CONFIG || own)}:`);
const doc = loadGatewayConfig();
const live = new Policy(doc);
check("config loads with a callers map", doc.callers && typeof doc.callers === "object");
check("an unlisted caller sees nothing", !live.allowed("caller-that-does-not-exist", "kb_search"));
for (const glob of doc.hard_deny ?? []) {
  const sample = String(glob).replace(/\*/g, "x");
  for (const caller of Object.keys(doc.callers ?? {})) {
    check(`hard_deny ${glob} holds for ${caller}`, !live.allowed(caller, sample));
  }
}
for (const prefix of doc.session_only ?? []) {
  for (const caller of Object.keys(doc.callers ?? {}).filter((c) => c !== "session")) {
    check(`${prefix}_* hidden from ${caller}`, !live.allowed(caller, `${prefix}_anything`));
  }
}

if (failures) { console.error(`\n${failures} check(s) FAILED`); process.exit(1); }
console.log("\nall scope checks passed");
