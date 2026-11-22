# Baseline Agents

Run your own team of AI agents. Each agent has a name, a persona, a memory, and a set of tools it is allowed to use. Your team talks to them in Slack, and they also run jobs on a schedule: a Monday digest, a nightly check, a daily report.

Every agent turn is a headless [Claude Code](https://docs.claude.com/en/docs/claude-code) run, so your agents can read files, follow skills, and use tools the way Claude Code does. Around that, this repo gives you:

- **A Slack runtime.** One small server answers every agent's @mentions and DMs, in threads, with thread memory.
- **A tool gateway.** One MCP server sits between your agents and every external tool, with a per-agent allowlist, hard denies nobody can lift, and a log of every call.
- **A knowledge base.** Markdown pages in `kb/` that every agent reads before answering.
- **Skills.** Reusable playbooks in `.claude/skills/` that agents and automations load on demand.
- **Memory.** A small per-agent file of standing preferences and corrections.
- **Automations.** Scheduled agent runs with caps, locks, run logs, and failure alerts.

It ships with one example agent, **Scout**, who answers questions from your knowledge base, and one example automation, **kb-digest**, which writes a weekly summary of what changed in the knowledge base.

---

## How it works

```
Slack ──HTTPS──▶ slack/receiver.mjs ──▶ slack/runner.mjs ──▶ claude -p (one turn)
                 verify signature        persona + memory          │
                 ack within 3s           + KB map + teammates      ▼
                                         + tool allowlist     gateway (MCP)
                                                              config/gateway.yaml
schedule ──▶ scripts/run-automation.sh ──▶ claude -p ───────▶ the same gateway
             lock, daily cap, logs, alerts
```

- You define agents in `agents/agents.json`, each with a persona file in `agents/personas/`.
- A Slack mention reaches `POST /slack/events/<agent>`. The receiver checks Slack's signature, acknowledges, then the runner starts one Claude Code turn with that agent's system prompt and tools, and posts the answer in the thread.
- Every tool call outside the repo goes through the gateway, which checks it against `config/gateway.yaml` for that agent, then logs it to `logs/toolcalls.jsonl`.
- Automations in `automations/automations.yaml` run the same way on a timer, without Slack.

---

## Requirements

- macOS or Linux, Node.js 20 or newer.
- [Claude Code](https://docs.claude.com/en/docs/claude-code) installed (`claude` on your PATH) and either a Claude subscription or an Anthropic API key.
- For Slack: a workspace where you can create apps, and a public HTTPS address for your receiver (a server with a domain, or a tunnel while testing).

---

## Quick start (about 10 minutes, no Slack needed)

1. **Install.**
   ```bash
   npm install
   cp .env.example .env
   ```
2. **Give headless Claude credentials.** Run `claude setup-token`, then paste the token into `.env` as `CLAUDE_CODE_OAUTH_TOKEN=`. (Or set `ANTHROPIC_API_KEY=` to bill per token.)
3. **Check the setup.** This validates your config and runs the offline tests (no Slack, no Claude, no cost):
   ```bash
   npm test
   ```
4. **Ask Scout a question.** One real agent turn, printed to your terminal:
   ```bash
   npm run ask -- scout "What plans do we sell?"
   ```
   Scout reads `kb/company/about.md` and answers from it, citing the page. A turn costs a few cents on Sonnet.
5. **Run the example automation.**
   ```bash
   npm run automation -- kb-digest
   ```
   It writes `files/kb-digest.md` and logs the run to `logs/runs.jsonl`.

Then replace the example page in `kb/company/` with real knowledge about your company, and ask again.

---

## Connect Slack

Each agent is its own Slack app, so each has its own name, avatar, and @mention.

1. **Get a public HTTPS address** that forwards to `127.0.0.1:8790`.
   - Testing: a tunnel (for example `cloudflared tunnel --url http://127.0.0.1:8790`) gives you a temporary `https://…` host.
   - Running for real: a server with a domain and Caddy. `infra/Caddyfile.example` exposes only `/slack/events/*`.
2. **Start the receiver** (keep it running):
   ```bash
   npm run receiver
   ```
3. **Create the Slack app.** At [api.slack.com/apps](https://api.slack.com/apps) → *Create New App* → *From a manifest*, paste `infra/slack-app-manifest.yaml` with `AGENT_NAME` = `Scout`, `AGENT_SLUG` = `scout`, and `YOUR_PUBLIC_HOST` = your host. Slack pings the URL straight away; the receiver answers that ping even before you've added credentials.
4. **Install the app** to your workspace, then copy two values into `.env`:
   - *Basic Information → Signing Secret* → `SLACK_SCOUT_SIGNING_SECRET=`
   - *OAuth & Permissions → Bot User OAuth Token* (`xoxb-…`) → `SLACK_SCOUT_BOT_TOKEN=`

   No restart needed: the receiver re-reads `.env` on every event.
5. **Copy the agent's Slack member ID** (open the app's bot profile in Slack → ⋮ → *Copy member ID*) into `agents/agents.json` as `"slackUserId"`. Other agents need it to mention Scout.
6. **Invite Scout** to a channel (`/invite @Scout`) and mention it: `@Scout what plans do we sell?`

You'll see a 👀 reaction within a second, then the answer in a thread. Follow-ups in that thread keep the conversation's context.

---

## Add an agent

Say you want **Quill**, a writer.

1. **Register it** in `agents/agents.json`:
   ```json
   "quill": {
     "name": "Quill",
     "role": "Writer",
     "description": "Drafts announcements and docs in the house voice.",
     "persona": "personas/quill.md",
     "caller": "slack-quill",
     "model": "sonnet",
     "slackUserId": null
   }
   ```
   The slug (`quill`) is part of its Slack URL and its secret names, so keep it lowercase with dashes. `model` is an alias (`haiku`, `sonnet`, `opus`); long or design- and debug-shaped requests escalate to `opus` automatically.
2. **Write its persona** in `agents/personas/quill.md`: who it is, what it does, what it never does, how it talks. Use `agents/personas/scout.md` as the pattern. Don't list teammates there; every agent gets the live roster from `agents.json` on each turn.
3. **Seed its memory**: create `memory/quill/MEMORY.md` (it can start with a heading and nothing else). See [Memory](#memory).
4. **Grant its tools** in `config/gateway.yaml` under `callers:`:
   ```yaml
   slack-quill:
     allow: [kb_search, kb_read_page, kb_list_pages, list_skills, read_skill, read_file]
   ```
5. **Check and try it locally**:
   ```bash
   npm run preflight
   npm run ask -- quill "Draft a two-line announcement for our new support hours."
   ```
   `npm run ask -- quill "anything" --show-prompt` prints the exact system prompt and tool list without running anything.
6. **Give it a Slack app**: repeat [Connect Slack](#connect-slack) steps 3–6 with `AGENT_SLUG=quill`, and the env names `SLACK_QUILL_SIGNING_SECRET` and `SLACK_QUILL_BOT_TOKEN`.

The receiver picks up registry changes without a restart.

### Agents working together

Agents hand work to each other by mentioning one another with real Slack mentions. Each agent's prompt carries the roster (name, role, description, mention ID) and a hand-off rule: stay in your own domain, hand off with a real mention, and mention the requester back when done. Bot-to-bot mentions in one thread are capped at 4 hops (`SLACK_BOT_HOP_CAP`), so two agents can never loop forever. An agent mentioned by another bot deep in a thread may stay silent (it outputs `NO_REPLY`); a human mention always gets an answer.

To let one agent start threads in other channels (a coordinator that routes work), add `"crossPostChannels": { "engineering": "C0123456789" }` to its entry. It can then post with `scripts/slack-send.sh`; every other agent can only reply where it was mentioned.

---

## Knowledge base

`kb/` is the shared memory of facts: what your company is, what was decided, how things work. On every turn each agent gets a map of it (`kb/log.md` plus every `kb/<category>/index.md`), then reads the real pages before answering. Agents are instructed never to state a fact they didn't read this turn.

- One page per topic: `kb/<category>/<page>.md`, with the frontmatter in `kb/README.md`.
- One line per page in `kb/<category>/index.md`. This is what agents see in their map; a page missing from its index is easy to miss.
- One line per change in `kb/log.md`, newest first. The kb-digest automation reads this.

Write pages so an agent can answer from the page alone: exact names, numbers, steps, and a **Gotchas** section for what bit you.

## Skills

A skill is a playbook in `.claude/skills/<name>/SKILL.md`: frontmatter with a `name` and a `description` that says *when* to use it, then the procedure. Agents load skills on demand with Claude Code's Skill tool (or the gateway's `read_skill`). Automations list the skills they may use under `skills:` and must grant `"Skill"`.

`.claude/skills/kb-digest/SKILL.md` is the example. Keep each skill to one workflow, and put the reusable procedure in the skill rather than in an automation's prompt, so agents in Slack and scheduled runs follow the same steps.

## Memory

`memory/<slug>/MEMORY.md` holds one agent's standing preferences and corrections: "always cite the page", "never quote prices to customers". It is injected into that agent's prompt every turn (capped at 4,000 characters), one line per entry, each pointing at a small file with the detail. See `memory/README.md`.

Memory is for *how an agent works*. *What the company knows* goes in `kb/`, where every agent can read it.

## Automations

An automation is a scheduled, headless agent run. The example in `automations/automations.yaml`:

```yaml
kb-digest:
  prompt_file: automations/prompts/kb-digest.md   # thin: "invoke the kb-digest skill"
  schedule:
    - { weekday: 1, hour: 9, minute: 0 }          # Mondays 09:00, machine local time
  allowed_tools: ["Read(./**)", "Glob(./**)", "Grep(./**)", "Edit(./files/**)", "Skill", "mcp__gateway", "Bash(bash scripts/slack-send.sh:*)"]
  skills: [kb-digest]
  max_runtime: 300        # seconds
  max_runs_per_day: 2     # scheduled runs; manual runs bypass it
  max_turns: 20
  agent_triggerable: true # agents may run it with the trigger_automation tool
  slack:
    post_as: scout                  # posts with Scout's bot token
    channel_env: DIGEST_CHANNEL_ID  # the .env variable holding the channel id
```

- Run one by hand: `npm run automation -- kb-digest`.
- Every run appends a row to `logs/runs.jsonl` and saves its transcript to `logs/automations/<name>/`.
- A failed run writes `logs/LAST_FAILURE.md` (removed by the next success) and, if `ALERT_CHANNEL_ID` and `ALERT_POST_AS` are set, posts an alert. A run that succeeds but hits 5+ permission denials is flagged as **degrading**: its prompt asks for something its tools don't allow.
- Give the automation its own caller entry in `config/gateway.yaml` (the caller name is the automation's name).
- `npm run preflight` catches mismatches before they cost you a run: missing prompt or skill files, a skill without the `Skill` grant, a `git` command in a prompt that `allowed_tools` doesn't grant.

### Put them on a schedule

```bash
npm run schedule            # show what would be installed
npm run schedule:install    # install (launchd on macOS, systemd user timers on Linux)
```

Nothing runs on a schedule until you install. Re-run `schedule:install` after changing a schedule; it also removes jobs for automations you deleted. On Linux, run `loginctl enable-linger $USER` once so jobs run while you're logged out. `npm run receiver:install` keeps the Slack receiver running the same way.

---

## Tools and permissions

Agents start with read-only access to this repo (`Read(./**)`), skills, and the gateway. Everything else is opt-in.

**The gateway** (`config/gateway.yaml`) is the one door to external tools:

- `upstreams`: the MCP servers your agents may reach (GitHub, a CRM, a docs server…). Commented examples are included. Each server's tools appear as `<prefix>_<tool>`.
- `callers.<name>.allow`: globs of tools each agent (`slack-<slug>`) or automation (`<automation-name>`) may use. A caller that isn't listed sees nothing.
- `hard_deny`: tools that must not exist for anyone, you included. The default denies anything matching `*_send_*`, `*_delete_*`, `*_trash_*`, and `github_merge_*`: agents draft, humans send.
- `read_only`: for an upstream named here, only tools matching its regex exist, including any it adds later.
- `session_only`: tools only you, at your own terminal, can use (for example a logged-in browser).
- `github`: every GitHub call must name a repo on `repo_allowlist` under `owner`; account-wide searches are denied.

The gateway's own file tools can write to `kb/`, `files/`, `memory/`, and `.claude/skills/`, and never to `agents/`, `config/`, `automations/`, `gateway/`, `slack/`, `scripts/`, `infra/`, or `.claude/settings.json`: an agent can't edit the files that decide what it may do.

Run `npm run scope-test` after every change. It tests the guards against a fixture, then checks invariants on your own config. `npm run smoke-test -- slack-scout` boots the real gateway as that caller and lists exactly what it sees.

### Let an agent work in a repo

Clone the repo under `workspaces/` (gitignored), then add it to the agent's entry:

```json
"workRepos": {
  "website": { "path": "workspaces/website", "repo": "your-org/website", "autoMerge": false }
}
```

The agent gains file writes inside `workspaces/website/` only, and `git -C workspaces/website <status|add|commit|checkout|switch|branch|diff|log|push|fetch|pull|rm>`. Never `reset`, `clean`, `rebase`, or `merge`. It works on a branch, pushes, and opens a pull request (grant `github_create_pull_request` in its gateway caller, and add the repo to `github.repo_allowlist`). With `"autoMerge": true` it may also run `gh pr merge --auto`. **Only turn that on for a repo with branch protection and a required CI check.** Without a check, auto-merge is an unreviewed merge to whatever deploys from main.

---

## Logs

All local, all gitignored, under `logs/`:

| File | What it tells you |
|---|---|
| `slack-agent/runs.jsonl` | one row per agent turn: agent, model, ok, cost, tokens |
| `slack-agent/failures.jsonl` | failed turns, with the tail of Claude's stderr |
| `runs.jsonl` | one row per automation run: status, denials, duration, cost |
| `automations/<name>/*.json` | the full transcript of each automation run |
| `LAST_FAILURE.md` | the latest automation failure (gone after the next success) |
| `toolcalls.jsonl` | every gateway tool call: caller, tool, ok, time |
| `slack-posts.jsonl` | a receipt for every confirmed `slack-send.sh` post |
| `scheduler/*.log` | output of scheduled jobs and the installed receiver |

## Troubleshooting

- **Agent never replies in Slack.** Check the receiver's output. `401` = wrong signing secret. `503` = that agent's two Slack values are missing from `.env`. Nothing logged at all = Slack isn't reaching your host (check the Request URL under *Event Subscriptions*).
- **"hit an error on that one".** Read the last line of `logs/slack-agent/failures.jsonl`. An auth error means headless Claude has no valid credential: set `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY` in `.env`. Test it with `npm run ask -- scout "hi"`, not with `claude` in your own shell, which uses your interactive login instead.
- **Agent says a tool isn't available.** It's not in that agent's caller in `config/gateway.yaml`, or the upstream didn't connect (the gateway prints `<prefix> unavailable` on stderr). `npm run smoke-test -- slack-<slug>` shows exactly what it sees.
- **Automation logs `ok` but did nothing.** Check `denials` in `logs/runs.jsonl`. A prompt asking for a command its `allowed_tools` doesn't grant fails quietly, one denial at a time.

## Gotchas

- **Write rules are `Edit(...)` rules.** In Claude Code, `Edit(path)` governs file writes; a `Write(path)` grant is silently ignored. Grant writes as `Edit(./files/**)`.
- **Scope file reads.** A bare `"Read"` grant reaches your whole filesystem. Use `Read(./**)`.
- **Don't put this repo inside another Claude Code project.** Claude Code loads `CLAUDE.md` files from parent folders into every agent turn, and agents will try to read the parent project's files.
- **`git -C <repo>`, never `cd`.** Bash grants match the literal start of a command; a `cd` first doesn't match, and would point git at the wrong repo.
- **Headless runs can't ask.** Anything outside an allowlist is denied, never queued for approval. Name every command a prompt or skill needs in `allowed_tools`, and run `npm run preflight`.

## Layout

```
agents/          agents.json (the roster) and personas/
memory/          one folder per agent: MEMORY.md + detail files
kb/              the knowledge base
.claude/skills/  skills
automations/     automations.yaml and prompts/
config/          gateway.yaml (tools and permissions)
gateway/         the MCP gateway
slack/           the Slack receiver and runner
scripts/         ask, run-automation, slack-send, preflight, schedule
infra/           Slack app manifest, Caddy example
files/           automation outputs (gitignored)
logs/            runtime logs (gitignored)
```
