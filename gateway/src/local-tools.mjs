/**
 * Local gateway tools: the knowledge base, the skill library, automations, and
 * repo file I/O, served from disk as real MCP tools. Any MCP client that
 * connects to the gateway gets the same view of the repo, through the same
 * policy, scope, and logging path as upstream tools.
 *
 * WRITE SCOPE IS STRUCTURAL. write_file/edit_file reach content (kb/, files/,
 * memory/, skills) but never the files that decide what a caller may do or
 * what the machine executes. There is deliberately no shell tool here.
 */
import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { ROOT, agentTriggerable, automationReport } from "./config.mjs";
import { loadAgents, loadChannels } from "../../core/config.mjs";

const pExecFile = promisify(execFile);
const READ_CAP = 200_000;
const SEARCH_MAX_HITS = 40;

/**
 * Top-level paths no caller may WRITE. Each one either gets executed or
 * decides permissions:
 *   .git/            hooks run on commit; history
 *   .claude/         settings.json hooks run shell on every turn
 *   agents/          the registry grants repo write access and channels
 *   config/          gateway.yaml IS the allowlist
 *   automations/     prompts and tool grants for scheduled runs
 *   core/, gateway/, slack/, scripts/, infra/   code the machine runs
 * Reads are unaffected. Checked on the RESOLVED path, so `kb/../gateway/x`
 * can't slip through.
 */
const WRITE_DENY_PREFIXES = [".git", ".claude", "agents", "config", "automations", "core", "gateway", "slack", "scripts", "infra", "node_modules", "logs"];

/** Carve-outs inside a denied prefix. A skill is markdown read by a model,
 * never executed; .claude/settings.json stays denied. */
const WRITE_ALLOW_PREFIXES = [".claude/skills/"];

/** Never readable through the gateway, regardless of caller. */
const READ_DENY_RE = /(^|\/)(\.env(\..*)?|.*\.pem|.*\.key|id_rsa.*|.*_tokens\.json)$/i;

/** Agent trigger cooldown per automation (ms). Bounds a looping agent. */
const AGENT_TRIGGER_COOLDOWN_MS = 90_000;
const triggerCooldown = new Map();

function resolveInRoot(rel) {
  if (typeof rel !== "string" || !rel.trim()) throw new Error("path is required");
  const abs = path.resolve(ROOT, rel);
  if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) throw new Error(`path escapes the repo: ${rel}`);
  return abs;
}
const relFromRoot = (abs) => path.relative(ROOT, abs).split(path.sep).join("/");

function assertReadable(abs) {
  const rel = relFromRoot(abs);
  if (READ_DENY_RE.test(rel)) throw new Error(`refusing to read a credential file: ${rel}`);
  return abs;
}

function assertWritable(abs) {
  const rel = relFromRoot(abs);
  assertReadable(abs);
  if (WRITE_ALLOW_PREFIXES.some((p) => rel.startsWith(p))) return abs;
  const top = rel.split("/")[0];
  if (WRITE_DENY_PREFIXES.includes(top)) {
    throw new Error(`writes to ${top}/ are denied structurally: that path controls execution or permissions. A human makes this change.`);
  }
  return abs;
}

export const LOCAL_TOOLS = [
  {
    name: "kb_search",
    description: "Search the knowledge base (kb/) for pages matching a query. Returns page slugs with a matching line: use kb_read_page to read one in full.",
    inputSchema: { type: "object", properties: { query: { type: "string", description: "Search terms (case-insensitive)" } }, required: ["query"] },
  },
  {
    name: "kb_read_page",
    description: 'Read a knowledge-base page by slug, e.g. "company/about".',
    inputSchema: { type: "object", properties: { slug: { type: "string", description: "category/slug, without kb/ or .md" } }, required: ["slug"] },
  },
  {
    name: "kb_list_pages",
    description: "List knowledge-base pages with their descriptions, optionally within one category folder.",
    inputSchema: { type: "object", properties: { category: { type: "string", description: "Optional category folder under kb/" } } },
  },
  {
    name: "list_skills",
    description: "List the skill library (.claude/skills) with each skill's description. Use read_skill to load one before doing work it covers.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "read_skill",
    description: "Read a skill's full SKILL.md playbook by name.",
    inputSchema: { type: "object", properties: { name: { type: "string", description: "Skill folder name" } }, required: ["name"] },
  },
  {
    name: "list_automations",
    description: "List the scheduled automations (automations/automations.yaml), including which are agent_triggerable.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "trigger_automation",
    description: "Run an agent_triggerable automation NOW and return its result. Blocks until the run finishes (up to ~200s) and reports its status; a longer run keeps going in the background and its outcome lands in logs/runs.jsonl.",
    inputSchema: { type: "object", properties: { name: { type: "string", description: "Automation name from list_automations" } }, required: ["name"] },
  },
  {
    name: "post_report",
    description: "Post a finished result (markdown) to a named report channel, as an agent. Works from any surface: the CLI, a Claude Code subagent, an app, an automation. `to` must be one of the agent's reportsTo channels. Returns whether it was posted; if the channel isn't connected, hand the person the text instead.",
    inputSchema: {
      type: "object",
      properties: {
        to: { type: "string", description: "Channel alias from config/channels.yaml" },
        text: { type: "string", description: "The message, in markdown" },
        as: { type: "string", description: "The agent slug posting. Required in interactive sessions; agents and automations post as themselves." },
      },
      required: ["to", "text"],
    },
  },
  {
    name: "read_file",
    description: "Read a repo file by repo-relative path. Credential files are refused.",
    inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  },
  {
    name: "write_file",
    description: "Create or OVERWRITE a repo file (parent folders created). Use for KB pages (kb/), deliverables (files/), agent memory (memory/), and skills (.claude/skills/). Writes to agents/, config/, automations/, gateway/, slack/, scripts/, infra/, .git/ and the rest of .claude/ are denied.",
    inputSchema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] },
  },
  {
    name: "edit_file",
    description: "Replace old_string with new_string in an existing repo file. old_string must appear EXACTLY ONCE. Same write scope as write_file.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" }, old_string: { type: "string" }, new_string: { type: "string" } },
      required: ["path", "old_string", "new_string"],
    },
  },
];

const LOCAL_NAMES = new Set(LOCAL_TOOLS.map((t) => t.name));
export const isLocalTool = (name) => LOCAL_NAMES.has(name);

function frontmatterField(text, field) {
  const m = text.match(new RegExp(`^${field}:\\s*(.+)$`, "m"));
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : null;
}

async function walkMarkdown(dir, acc = []) {
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await walkMarkdown(full, acc);
    else if (e.name.endsWith(".md")) acc.push(full);
  }
  return acc;
}

export async function runLocalTool(name, args = {}, caller = "session") {
  return { content: [{ type: "text", text: await dispatch(name, args ?? {}, caller) }] };
}

/**
 * Who is posting, and where may they post? The caller decides, not the
 * arguments: an agent's turn (slack-<slug> or its own caller) posts only as
 * itself; an automation posts as its report.as; only the interactive session
 * (a human, or a subagent inside their Claude Code) may name `as`. In every
 * case the destination must be on that agent's reportsTo (or the automation's
 * report.to).
 */
function resolveReporter(caller, args) {
  const agents = loadAgents();
  const own = Object.entries(agents).find(([slug, a]) => (a.caller || `slack-${slug}`) === caller);
  if (own) {
    const [slug, a] = own;
    if (args.as && args.as !== slug) return { error: `caller ${caller} may only post as ${slug}` };
    return { as: slug, allowed: a.reportsTo ?? [] };
  }
  const auto = automationReport(caller);
  if (auto) {
    if (args.as && args.as !== auto.as) return { error: `automation ${caller} posts as ${auto.as}` };
    return { as: auto.as, allowed: auto.to };
  }
  if (caller === "session") {
    const as = String(args.as ?? "");
    if (!agents[as]) return { error: `pass "as": one of ${Object.keys(agents).join(", ")}` };
    return { as, allowed: agents[as].reportsTo ?? [] };
  }
  return { error: `caller ${caller} is not an agent or automation with a report target` };
}

async function postReport(args, caller) {
  const to = String(args.to ?? "").trim();
  const text = String(args.text ?? "").trim();
  if (!to || !text) return "Error: `to` and `text` are required.";
  const who = resolveReporter(caller, args);
  if (who.error) return `Error: ${who.error}.`;
  if (!who.allowed.includes(to)) return `Error: ${who.as} may not post to "${to}". Allowed: ${who.allowed.join(", ") || "none (set reportsTo in agents/agents.json)"}.`;
  const channel = loadChannels()[to];
  if (!channel) return `Error: no channel "${to}" in config/channels.yaml.`;
  if (process.env.AGENTS_REPORT_DRY_RUN === "1") {
    await fs.mkdir(path.join(ROOT, "logs"), { recursive: true });
    await fs.appendFile(path.join(ROOT, "logs", "reports-dryrun.jsonl"), JSON.stringify({ ts: new Date().toISOString(), caller, as: who.as, to, slack: channel.slack || null, chars: text.length }) + "\n");
    return `Dry run: would post ${text.length} chars to "${to}" as ${who.as}.`;
  }
  if (!channel.slack) return `Not posted: channel "${to}" isn't connected (its Slack channel id is empty in .env). Give the person the text instead.`;
  const { postAsAgent } = await import("../../slack/post.mjs");
  const r = await postAsAgent({ as: who.as, channelId: channel.slack, text, caller });
  return r.ok ? `Posted to "${to}" as ${who.as} (Slack message ${r.ts}).` : `Not posted: ${r.error}. Give the person the text instead.`;
}

async function readRuns(auto) {
  try {
    const t = await fs.readFile(path.join(ROOT, "logs", "runs.jsonl"), "utf8");
    return t.trim().split("\n").map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter((r) => r && r.automation === auto && r.status !== "skipped_cap");
  } catch {
    return [];
  }
}

async function dispatch(name, args, caller) {
  switch (name) {
    case "post_report":
      return postReport(args, caller);

    case "kb_search": {
      const query = String(args.query ?? "").trim();
      if (!query) return "Error: query is required.";
      let stdout = "";
      try {
        ({ stdout } = await pExecFile("grep", ["-rniIF", "--include=*.md", "-m", "3", "--", query, "kb"], { cwd: ROOT, maxBuffer: 4 * 1024 * 1024 }));
      } catch {
        return `No KB pages matched "${query}".`;
      }
      const hits = stdout.trim().split("\n").filter(Boolean).slice(0, SEARCH_MAX_HITS).flatMap((row) => {
        const m = row.match(/^kb\/(.+?)\.md:(\d+):(.*)$/);
        return m ? [`${m[1]} (line ${m[2]}): ${m[3].trim().slice(0, 200)}`] : [];
      });
      return hits.length ? hits.join("\n") : `No KB pages matched "${query}".`;
    }

    case "kb_read_page": {
      const slug = String(args.slug ?? "").replace(/^kb\//, "").replace(/\.md$/, "");
      if (!/^[a-z0-9][a-z0-9/_-]*$/i.test(slug)) return "Invalid page slug.";
      try {
        return await fs.readFile(assertReadable(resolveInRoot(`kb/${slug}.md`)), "utf8");
      } catch {
        return `No KB page at "${slug}". Use kb_list_pages or kb_search to find the right one.`;
      }
    }

    case "kb_list_pages": {
      const category = String(args.category ?? "").replace(/[^a-z0-9-]/gi, "");
      const files = await walkMarkdown(resolveInRoot(category ? `kb/${category}` : "kb"));
      if (!files.length) return category ? `No pages under kb/${category}.` : "No KB pages found.";
      const rows = await Promise.all(files.sort().map(async (f) => {
        const rel = relFromRoot(f).replace(/^kb\//, "").replace(/\.md$/, "");
        let body = "";
        try { body = await fs.readFile(f, "utf8"); } catch {}
        const desc = frontmatterField(body, "description") ?? frontmatterField(body, "title") ?? "";
        return desc ? `${rel}: ${desc}` : rel;
      }));
      return `${rows.length} page(s):\n${rows.join("\n")}`;
    }

    case "list_skills": {
      let dirs = [];
      try { dirs = await fs.readdir(resolveInRoot(".claude/skills")); } catch { return "No skills installed."; }
      const rows = [];
      for (const d of dirs.sort()) {
        if (d.startsWith(".")) continue;
        let body = "";
        try { body = await fs.readFile(resolveInRoot(`.claude/skills/${d}/SKILL.md`), "utf8"); } catch { continue; }
        const desc = frontmatterField(body, "description") ?? "";
        rows.push(desc ? `${d}: ${desc}` : d);
      }
      return rows.length ? rows.join("\n\n") : "No skills installed.";
    }

    case "read_skill": {
      const skill = String(args.name ?? "").trim();
      if (!/^[a-z0-9][a-z0-9-]*$/i.test(skill)) return "Invalid skill name.";
      try {
        return await fs.readFile(resolveInRoot(`.claude/skills/${skill}/SKILL.md`), "utf8");
      } catch {
        return `No skill named "${skill}". Use list_skills to see what's available.`;
      }
    }

    case "list_automations": {
      try { return await fs.readFile(resolveInRoot("automations/automations.yaml"), "utf8"); } catch { return "No automations configured."; }
    }

    case "trigger_automation": {
      const auto = String(args.name ?? "").trim();
      const allowed = agentTriggerable();
      if (!allowed.has(auto)) return `Error: "${auto}" is not agent_triggerable. Allowed: ${[...allowed].join(", ") || "none"}.`;
      // Already running (its own lock is held) → report, don't stack a second run.
      try {
        await fs.access(path.join(ROOT, "logs", ".locks", auto));
        return `${auto} is already running: wait for it to finish, then check logs/runs.jsonl.`;
      } catch {}
      const nowMs = Date.now();
      const lastMs = triggerCooldown.get(auto) ?? 0;
      if (nowMs - lastMs < AGENT_TRIGGER_COOLDOWN_MS) {
        return `${auto} was triggered ${Math.round((nowMs - lastMs) / 1000)}s ago: wait at least ${AGENT_TRIGGER_COOLDOWN_MS / 1000}s between triggers.`;
      }
      triggerCooldown.set(auto, nowMs);
      const before = (await readRuns(auto)).length;
      // Detached, so an MCP client timeout never kills the run.
      try {
        const child = spawn("/bin/bash", [path.join(ROOT, "scripts", "run-automation.sh"), auto, "--trigger=agent"], { cwd: ROOT, detached: true, stdio: "ignore" });
        child.unref();
      } catch (e) {
        return `Error: failed to start ${auto}: ${e.message}`;
      }
      const deadline = Date.now() + 200_000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 3000));
        const rows = await readRuns(auto);
        if (rows.length > before) {
          const row = rows[rows.length - 1];
          const secs = row.duration_ms != null ? `, ${Math.round(row.duration_ms / 1000)}s` : "";
          const turns = row.turns != null ? `, ${row.turns} turns` : "";
          const failNote = row.status !== "ok" ? " See logs/LAST_FAILURE.md for detail." : "";
          return `Ran ${auto} (trigger=agent): status=${row.status}${turns}${secs}.${failNote}`;
        }
      }
      return `Triggered ${auto}: still running after 200s. Its outcome will land in logs/runs.jsonl.`;
    }

    case "read_file": {
      const body = await fs.readFile(assertReadable(resolveInRoot(String(args.path ?? ""))), "utf8");
      return body.length > READ_CAP ? body.slice(0, READ_CAP) + `\n\n… (truncated at ${READ_CAP} chars)` : body;
    }

    case "write_file": {
      const abs = assertWritable(resolveInRoot(String(args.path ?? "")));
      const content = String(args.content ?? "");
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, content);
      return `Wrote ${content.length} chars to ${relFromRoot(abs)}.`;
    }

    case "edit_file": {
      const abs = assertWritable(resolveInRoot(String(args.path ?? "")));
      const oldS = String(args.old_string ?? "");
      const newS = String(args.new_string ?? "");
      const rel = relFromRoot(abs);
      const cur = await fs.readFile(abs, "utf8");
      const count = oldS ? cur.split(oldS).length - 1 : 0;
      if (count === 0) return `Error: old_string not found in ${rel}. Read the file and copy the exact text.`;
      if (count > 1) return `Error: old_string appears ${count} times in ${rel}: add context so it matches once.`;
      await fs.writeFile(abs, cur.replace(oldS, () => newS));
      return `Edited ${rel}.`;
    }

    default:
      return `Unknown local tool "${name}".`;
  }
}
