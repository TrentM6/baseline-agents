# Baseline Agents: contract for anyone changing this repo

Read this before changing the framework itself (`core/`, `gateway/`, `slack/`, `scripts/`, config formats). It applies to people and to coding agents. `README.md` is the user guide; this file is the map and the rules.

## The shape

Every piece stands alone. An agent works with nothing but Claude Code and this repo; the gateway, reporting and Slack are each optional, and nothing outside this repo is assumed to exist. An agent is defined once and runs on any surface. Keep it that way:

- **`core/`** owns what makes an agent that agent: registry (`config.mjs`), system prompt and tool allowlist (`prompt.mjs`), one headless turn (`run.mjs`), the KB map (`kb.mjs`). It imports nothing from `slack/`.
- **Surfaces** add only their own etiquette, through `buildSystem(agent, { surfaceRules, mentions, home })`:
  - CLI: `scripts/ask.mjs` (`LOCAL_RULES`)
  - Claude Code subagents: `scripts/agents-sync.mjs` (`SUBAGENT_RULES`)
  - Apps: `runAgent()` from `core/index.mjs`
  - Automations: `scripts/run-automation.mjs` (its own headless rules)
  - Slack: `slack/turn.mjs` (`slackRules`, `NO_REPLY`, thread context)
- **The gateway is optional.** It's on when `config/gateway.yaml` exists (`npm run gateway:on`), checked by `gatewayEnabled()`. Off: runs get no `--mcp-config`, so Claude Code's own MCP config applies, limited by the allowlist; prompts carry no gateway-only instructions. On: the gateway is the only MCP server for headless runs (`mcpArgs()`).
- **Reporting** is one gateway tool, `post_report`, usable from every surface once the gateway is on. The Slack adapter's outbound side (`slack/post.mjs`) is the only code that holds a bot token for it.

## The map: who writes what, who reads it

| Data | Written by | Read by |
|---|---|---|
| `agents/agents.json` | people | `core/config.mjs` (hot-reloaded on mtime), `preflight.mjs`, `agents-sync.mjs`, every agent's teammates section, gateway `post_report` (caller → agent) |
| `agents/personas/<slug>.md` | people | `core/prompt.mjs` → `buildSystem()`, every surface |
| `memory/<slug>/MEMORY.md` | people (or agents, via PR) | `loadMemory()`, every surface, capped at 4,000 chars |
| `kb/**` | people, agents (gateway `write_file`) | `core/kb.mjs` → `kbMap()`; agents read pages directly |
| `.claude/skills/*/SKILL.md` | people, agents (gateway `write_file`) | Skill tool; gateway `list_skills` / `read_skill`; automation skills hint |
| `config/gateway.yaml` (optional; template `gateway.example.yaml`) | people only (gateway write-denied) | `gateway/src/policy.mjs`, `upstreams.mjs`, `scope-test.mjs`, `preflight.mjs`, `agents-sync.mjs` (via the live gateway) |
| `config/channels.yaml` | people only | `loadChannels()`: report rules in prompts, `post_report` |
| `automations/automations.yaml` | people only | `run-automation.mjs`, `schedule.mjs`, `preflight.mjs`, gateway (`agent_triggerable`, `report`) |
| `.env` | people only (never committed, unreadable through the gateway) | `core/config.mjs` (`envValue` re-reads it), `run-automation.sh`, `gateway/src/config.mjs` |
| `.claude/agents/*.md` (gitignored) | `agents-sync.mjs` | Claude Code |
| `.mcp.json` (gitignored) | `scripts/gateway.mjs on` | interactive Claude Code sessions in this repo |
| `logs/agents/runs.jsonl`, `failures.jsonl` | `core/run.mjs`, every headless turn | people |
| `logs/slack-agent/sessions.json` | `slack/turn.mjs` | Slack thread → Claude session for `--resume` |
| `logs/runs.jsonl`, `logs/automations/<name>/*.json`, `logs/LAST_FAILURE.md` | `run-automation.mjs` | people; `trigger_automation` polls `runs.jsonl` |
| `logs/toolcalls.jsonl` | gateway, every call | people |
| `logs/slack-posts.jsonl` | `slack/post.mjs`, `slack/send.sh`, per confirmed post | people |

Runtime shape: a headless turn = `claude -p` with cwd = the agent's working folder, `AGENTS_CALLER=<caller>` (`agent-<slug>` by default), and, with the gateway on, `--mcp-config` = the gateway with absolute paths plus `--strict-mcp-config`. Outside the agents repo it adds `--add-dir <repo>` and `Read(//<repo>/**)`. A subagent runs inside a person's Claude Code session, so the gateway (if on) sees caller `session`; its `tools:` list (resolved at sync time) is what limits it.

## Cascade checklists: if you change X, also touch Y

**New field in `agents.json`:** read it in `resolveAgent()` (`core/config.mjs`), use it in `core/prompt.mjs` (or the surface that needs it), validate it in `preflight.mjs`, cover it in `core/selftest.mjs`, document it in README "Add an agent". If it changes what a subagent can do, also `agents-sync.mjs`.

**New surface:** build the prompt with `buildSystem()` and run turns with `runClaude()`; pass `surface` for the logs. Never assemble a persona, memory or allowlist yourself. Add its checks to `core/selftest.mjs` and a section to README "Work with your agents".

**New tool grant shape (`buildAllowedTools`):** add a selftest case that asserts both the grant AND the absence of anything broader. Prove the permission syntax with a real `claude -p` run first: `Write(path)` looked right and is silently inert (writes are `Edit(path)` rules).

**New system-prompt block:** put it in `core/prompt.mjs` if it's about the agent, in the surface if it's etiquette. Keep it generic (no names, channels or IDs; read those from config). Check with `npm run ask -- scout "x" --show-prompt`.

**New local gateway tool:** `LOCAL_TOOLS` + `dispatch()` in `gateway/src/local-tools.mjs`. Writes go through `assertWritable()`. If the caller's identity matters, take it from the `caller` argument, never from tool arguments alone (see `resolveReporter()`). Add deny cases to `scope-test.mjs` or `core/selftest.mjs`, grant it in the example callers, document it in README.

**New report adapter (beyond Slack):** add an id field per channel in `config/channels.yaml`, an outbound module like `slack/post.mjs`, and a branch in `postReport()`. Keep "not connected" a normal answer, not an error.

**New field in `automations.yaml`:** `run-automation.mjs`, `preflight.mjs`, the field list in the `automations.yaml` header, README "Automations". Schedule format changes also touch both renderers in `schedule.mjs`.

## Verify before calling it done

```bash
npm test                                         # preflight + scope-test + core + slack selftests (offline, free)
npm run smoke-test -- agent-scout                # the real gateway lists the right tools
npm run ask -- scout "What plans do we sell?"    # one real turn (cents)
npm run ask -- scout "Check the README" --in <some folder>   # a turn in another folder
npm run agents:sync && claude -p "Use the scout subagent: what does the Team plan cost?" --allowedTools "Task,Agent"
npm run automation -- kb-digest                  # check denials in logs/runs.jsonl
```

Run the real turns with the gateway off (the default) AND on (`npm run gateway:on`, then `gateway:off`). A green offline test proves wiring, not behavior. For any change to prompts, grants or the runner, do a real turn and read `permission_denials`.

## Invariants (never trade these away)

- **Every piece stands alone.** `core/` never imports `slack/` or `gateway/`. Nothing assumes the gateway, Slack, or any product outside this repo; optional pieces are switched on, never required.
- **One agent definition, every surface.** Surfaces never rebuild what `buildSystem()` / `buildAllowedTools()` return.
- **Deny by default, everywhere.** A run gets only the tools it's granted. Unknown gateway caller → no gateway tools. Headless → no permission prompts; outside the allowlist means denied.
- **Dangerous capabilities are absent, not ungranted** (gateway on). Sending, deleting, merging, money movement go in `hard_deny` or `read_only`, which apply to every caller. `second_opinion` stays off unless the config turns it on.
- **Agents can't edit what governs them.** `agents/`, `config/`, `automations/`, `core/`, `gateway/`, `slack/`, `scripts/`, `infra/`, `.claude/settings.json` stay in `WRITE_DENY_PREFIXES`.
- **File tools are scoped.** `Read(./**)`, `Grep(./**)`, `Glob(./**)`, `Edit(./<path>/**)`, `Read(//<agents repo>/**)` when working elsewhere. Never a bare `Read` or `Edit` in a headless run.
- **Repo work is `git -C <path>` only**, with a fixed subcommand list. No reset, clean, rebase, merge. `autoMerge` only behind a required CI check.
- **The gateway decides who posts.** `post_report` takes identity from the caller; only `session` may name `as`, and the destination must be on that agent's `reportsTo` (or the automation's `report.to`). No turn receives a Slack token.
- **Slack: ack within 3s, verify every request, dedupe by event_id, cap bot hops per thread.**
- **Never silent.** A failed turn says so; a restart mid-turn posts a notice; a failed automation writes `LAST_FAILURE.md`, and a success retires it.
- **Model aliases, never dated model IDs.**
- **No secrets in git.** `.env` is gitignored and unreadable through the gateway.

## Gotchas

- `claude` run in a folder nested inside another Claude Code project loads the parent's `CLAUDE.md`; agents then try to read the parent's files. The `./**` scopes deny those reads, but the instructions still leak into context. Keep this repo top-level.
- Testing auth with `claude` in your own shell tests your interactive login, not the API key in `.env`. Test with `npm run ask`.
- An automation has no next turn. A backgrounded command dies with the run while the run logs `ok`; the runner's headless rules forbid it and "in the background" in the final message marks the run degraded.
- Subagent files embed the KB map at sync time. They go stale when the KB changes; `preflight` warns, `agents:sync` fixes.
