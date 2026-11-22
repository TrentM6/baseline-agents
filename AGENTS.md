# Baseline Agents — contract for anyone changing this repo

Read this before changing the framework itself (`slack/`, `gateway/`, `scripts/`, config formats). It applies to humans and to coding agents. `README.md` is the user guide; this file is the map and the rules.

## The map: who writes what, who reads it

| Data | Written by | Read by |
|---|---|---|
| `agents/agents.json` | humans | `slack/config.mjs` (hot-reloaded on mtime), `scripts/preflight.mjs`, every agent's "teammates" prompt section |
| `agents/personas/<slug>.md` | humans | `slack/runner.mjs` → `buildSystem()`, every turn |
| `memory/<slug>/MEMORY.md` | humans (or agents, via PR) | `runner.mjs` → `loadMemory()`, every turn, capped at 4,000 chars |
| `kb/**` | humans, agents (gateway `write_file`) | `slack/kb.mjs` → `kbMap()` every turn; agents read pages directly |
| `.claude/skills/*/SKILL.md` | humans, agents (gateway `write_file`) | Claude Code's Skill tool; gateway `list_skills` / `read_skill`; `run-automation.mjs` skills hint |
| `config/gateway.yaml` | humans only (write-denied to the gateway) | `gateway/src/policy.mjs`, `upstreams.mjs`, `scope-test.mjs`, `preflight.mjs` |
| `automations/automations.yaml` | humans only | `run-automation.mjs`, `schedule.mjs`, `preflight.mjs`, gateway (`agent_triggerable`) |
| `.env` | humans only (never committed, never readable through the gateway) | `slack/config.mjs` (re-read per Slack event), `run-automation.sh`, `gateway/src/config.mjs` |
| `logs/slack-agent/runs.jsonl`, `failures.jsonl`, `sessions.json` | `runner.mjs` | humans; `sessions.json` maps thread → Claude session for `--resume` |
| `logs/runs.jsonl`, `logs/automations/<name>/*.json`, `logs/LAST_FAILURE.md` | `run-automation.mjs` | humans; gateway `trigger_automation` polls `runs.jsonl` |
| `logs/toolcalls.jsonl` | gateway, every call | humans |
| `logs/slack-posts.jsonl` | `scripts/slack-send.sh`, per confirmed post | humans; the proof a message landed |

Runtime shape: one receiver process (`slack/receiver.mjs`, 127.0.0.1:8790) → one `claude -p` child per turn, cwd = repo root, `--mcp-config .mcp.json --strict-mcp-config`, `AGENTS_CALLER=<caller>`. Claude Code spawns the gateway (`gateway/src/index.mjs`) per turn over stdio. Automations: scheduler → `scripts/run-automation.sh` → `run-automation.mjs` → `claude -p`, same gateway.

## Cascade checklists: if you change X, also touch Y

**New field in `agents.json`:** read it in `resolveAgent()` (`slack/config.mjs`) → use it in `runner.mjs` → validate it in `scripts/preflight.mjs` → cover it in `slack/selftest.mjs`'s fixture → document it in README "Add an agent".

**New tool grant shape for agents (`buildAllowedTools`):** add a selftest case that asserts both the grant AND the absence of anything broader. Prove the permission syntax with a real `claude -p` run before trusting it: `Write(path)` looked right and is silently inert (file writes are `Edit(path)` rules).

**New system-prompt block in `buildSystem()`:** keep it generic (no names, channels, or IDs; read those from config). Check the result with `npm run ask -- scout "x" --show-prompt`.

**New local gateway tool:** add it to `LOCAL_TOOLS` and `dispatch()` in `gateway/src/local-tools.mjs`. If it writes, route it through `assertWritable()`. If it has dangerous arguments, add a `scopeViolation()` rule in `policy.mjs` and a deny case in `gateway/scope-test.mjs`. Grant it per caller in `config/gateway.yaml` (example callers included). Document it in README "Tools and permissions".

**New field in `automations.yaml`:** `run-automation.mjs` → `preflight.mjs` → the field list in the `automations.yaml` header comment → README "Automations". Schedule format changes also touch `schedule.mjs` (both launchd and systemd renderers).

**New script a skill or automation calls:** the automation must grant it as `Bash(<exact command prefix>:*)`; add the grant to the example and teach `preflight.mjs` to check for it if the pairing is common (see the `slack.post_as` ↔ `slack-send.sh` check).

## Verify before calling it done

```bash
npm test                              # preflight + scope-test + slack selftest (offline, free)
npm run smoke-test -- slack-scout     # the real gateway boots and lists the right tools
npm run ask -- scout "What plans do we sell?"   # one real turn (costs cents)
npm run automation -- kb-digest       # one real automation run; check denials in logs/runs.jsonl
```

A green offline test proves wiring, not behavior. For any change to prompts, grants, or the runner, do the real turn and read `permission_denials` in the transcript.

## Invariants (never trade these away)

- **Deny by default, everywhere.** Unknown caller → no gateway tools. Headless → no permission prompts; out-of-allowlist means denied.
- **Dangerous capabilities are absent, not ungranted.** Sending, deleting, merging, money movement go in `hard_deny` or `read_only`, which apply to every caller.
- **Agents can't edit what governs them.** `agents/`, `config/`, `automations/`, `gateway/`, `slack/`, `scripts/`, `infra/`, `.claude/settings.json` stay in `WRITE_DENY_PREFIXES`.
- **File tools are scoped to the repo.** `Read(./**)`, `Grep(./**)`, `Glob(./**)`, `Edit(./<path>/**)`. Never a bare `Read` or `Edit`.
- **Repo work is `git -C <path>` only**, with a fixed subcommand list. No reset, clean, rebase, merge. `autoMerge` only behind a required CI check.
- **Slack: ack within 3s, verify every request, dedupe by event_id, cap bot hops per thread.** The receiver never processes an unverified event.
- **Tokens stay with the runner.** A turn's child process gets a Slack token only if the agent has `crossPostChannels`.
- **Never silent.** A failed turn posts an honest error; a restart mid-turn posts an interruption notice; a failed automation writes `LAST_FAILURE.md`. A success retires its failure flag.
- **Model aliases, never dated model IDs**, so new models need no change.
- **No secrets in git.** `.env` is gitignored and unreadable through the gateway (`READ_DENY_RE`).

## Gotchas

- `claude` run inside a folder nested in another Claude Code project loads the parent's `CLAUDE.md`; agents then try to read the parent's files. The `./**` scopes deny those reads, but the instructions still leak into context. Keep this repo top-level.
- Testing auth with `claude` in your own shell tests your interactive login, not the headless credential in `.env`. Test with `npm run ask`.
- An automation has no next turn. A backgrounded command dies with the run while the run logs `ok`; `HEADLESS_DISCIPLINE` forbids it and `run-automation.mjs` flags "in the background" as degraded.
