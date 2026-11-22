import { loadGatewayConfig, agentTriggerable } from "./config.mjs";

/**
 * The gateway's permission model. Two layers, both deny-by-default:
 *
 * 1. NAME level: is tool X visible/callable for caller Y?
 *    - `hard_deny` globs: never visible to ANY caller, sessions included.
 *      Use these for capabilities that must not exist (sending email,
 *      deleting data, merging). A capability that is absent can't be
 *      granted by a later allowlist mistake.
 *    - `read_only` prefixes: for an upstream named here, only tools matching
 *      its regex exist. Everything else under that prefix is denied, so a
 *      new write tool the upstream adds later is denied until you say so.
 *    - `session_only` prefixes: visible only to the interactive `session`
 *      caller, never to agents or automations (e.g. a logged-in browser).
 *    - `callers.<name>.allow` globs: the per-caller grant.
 *
 * 2. ARGUMENT level: scopeViolation(): GitHub calls must name an
 *    allowlisted repo (and the configured owner); account-wide searches are
 *    denied because the token can usually see more than agents may touch.
 *    trigger_automation may only name an `agent_triggerable` automation.
 */

function globToRe(glob) {
  return new RegExp("^" + String(glob).split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$");
}

/** GitHub tools that act on the authenticated user only (no repo reach). */
const GITHUB_USER_SCOPED = new Set(["github_get_me"]);

export class Policy {
  constructor(doc = loadGatewayConfig()) {
    this.callers = doc.callers ?? { session: { allow: ["*"] } };
    this.hardDeny = (doc.hard_deny ?? []).map(globToRe);
    this.readOnly = Object.entries(doc.read_only ?? {}).map(([prefix, re]) => [prefix, new RegExp(re)]);
    this.sessionOnly = (doc.session_only ?? []).map(String);
    this.githubOwner = doc.github?.owner ? String(doc.github.owner).toLowerCase() : null;
    this.githubRepoAllowlist = new Set((doc.github?.repo_allowlist ?? []).map((r) => String(r).toLowerCase()));
    this.triggerable = agentTriggerable();
  }

  /** Argument-level scope check. Returns null if OK, else a denial reason. */
  scopeViolation(tool, args) {
    if (tool.startsWith("github_")) {
      if (GITHUB_USER_SCOPED.has(tool)) return null;
      const owner = args?.owner ?? args?.org ?? args?.username;
      const repo = args?.repo ?? args?.repository;
      const ownerOk = (o) => !this.githubOwner || String(o).toLowerCase() === this.githubOwner;
      // Creating a repo can't pass the allowlist (it doesn't exist yet).
      // Allowed only under the configured owner. The new repo is NOT
      // auto-allowlisted: a human adds it to config/gateway.yaml.
      if (tool === "github_create_repository") {
        if (owner && !ownerOk(owner)) return `owner ${owner} is not the configured GitHub owner`;
        return null;
      }
      if (owner && !ownerOk(owner)) return `owner ${owner} is not the configured GitHub owner`;
      if (owner && repo) {
        return this.githubRepoAllowlist.has(`${owner}/${repo}`.toLowerCase())
          ? null
          : `repo ${owner}/${repo} is not in github.repo_allowlist`;
      }
      return `${tool} without an allowlisted owner/repo is denied (account-wide reach)`;
    }
    if (tool === "trigger_automation") {
      const name = String(args?.name ?? "");
      return this.triggerable.has(name)
        ? null
        : `automation "${name}" is not agent_triggerable (allowed: ${[...this.triggerable].join(", ") || "none"})`;
    }
    return null;
  }

  /** Is `tool` visible/callable for `caller`? */
  allowed(caller, tool) {
    if (this.hardDeny.some((re) => re.test(tool))) return false;
    for (const [prefix, re] of this.readOnly) {
      if (tool.startsWith(prefix + "_") && !re.test(tool)) return false;
    }
    if (caller !== "session" && this.sessionOnly.some((p) => tool.startsWith(p + "_"))) return false;
    const globs = this.callers[caller]?.allow ?? [];
    return globs.map(globToRe).some((re) => re.test(tool));
  }

  filterTools(caller, tools) {
    return tools.filter((t) => this.allowed(caller, t.name));
  }
}
