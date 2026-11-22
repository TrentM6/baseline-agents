# Baseline Agents

A team of agents that works wherever you do, each with its own skills, memory and schedule.

Define an agent once: who it is, what it knows, which tools it may use, when it runs. Then work with it in Claude Code, from your terminal, inside another project or app, or on a schedule. Connect Slack if you want your agents to answer there and report back there.

Every agent turn is a [Claude Code](https://docs.claude.com/en/docs/claude-code) run, so your agents read files, follow skills and use tools the way Claude Code does. Around that, this repo gives you:

- **Agents defined once.** A roster in `agents/agents.json`, a persona per agent, and the same behavior on every surface.
- **A knowledge base.** Markdown pages in `kb/` that every agent reads before answering.
- **Skills.** Reusable playbooks in `.claude/skills/` that agents load on demand.
- **Memory.** A small per-agent file of standing preferences and corrections.
- **A tool gateway.** One MCP server between your agents and every external tool, with a per-agent allowlist, hard denies nobody can lift, and a log of every call.
- **Automations.** Scheduled agent runs with caps, locks, run logs and failure alerts.
- **Reporting.** An agent working anywhere can post a finished result to a channel you name.
- **Slack, optional.** Each agent can be its own Slack app that answers @mentions and DMs in threads.

It ships with one example agent, **Scout**, who answers questions from your knowledge base, and one example automation, **kb-digest**, which writes a weekly summary of what changed in it.

---

## How it works

```
                 ┌──────────────── one agent definition ────────────────┐
                 │ agents/agents.json · persona · memory · kb · skills  │
                 │ tool allowlist (config/gateway.yaml) · schedule       │
                 └──────────────────────────────────────────────────────┘
                                          │
   surfaces:  Claude Code subagent · npm run ask · your app (core/index.mjs)
              scheduled automation · Slack (optional)
                                          │
                          claude (one turn) ──▶ gateway (MCP)
                                                 └─ post_report ──▶ Slack channel
```

- `core/` builds an agent's system prompt and tool allowlist and runs a turn. Nothing in it depends on Slack.
- Each surface adds only its own etiquette. A Slack reply is brief and threaded; a terminal answer is direct; the agent is the same.
- Every tool outside the repo goes through the gateway, which checks the call against that agent's allowlist and logs it to `logs/toolcalls.jsonl`.

---

## Requirements

- macOS or Linux, Node.js 20 or newer.
- [Claude Code](https://docs.claude.com/en/docs/claude-code) installed (`claude` on your PATH).
- An [Anthropic API key](https://console.anthropic.com). See [Claude credentials](#claude-credentials).
- Slack only if you want it.

---

## Quick start (about 10 minutes, all local)

1. **Install.**
   ```bash
   npm install
   cp .env.example .env
   ```
2. **Add your Anthropic API key** to `.env` as `ANTHROPIC_API_KEY=`.
3. **Check the setup.** Offline tests, no cost:
   ```bash
   npm test
   ```
4. **Make your agents available in Claude Code.**
   ```bash
   npm run agents:sync
   ```
   This writes one Claude Code subagent per agent to `.claude/agents/`. Open Claude Code in this folder and ask for one by name: *"ask scout what plans we sell"*. Scout reads `kb/company/about.md` and answers, citing the page.
5. **Or ask from your terminal**, without opening Claude Code:
   ```bash
   npm run ask -- scout "What plans do we sell?"
   ```
6. **Run the example automation.**
   ```bash
   npm run automation -- kb-digest
   ```
   It writes `files/kb-digest.md` and logs the run to `logs/runs.jsonl`.

Then replace the example page in `kb/company/` with real knowledge about your company, and ask again.

### Claude credentials

Every agent turn is a Claude Code run, and it needs a credential.

- **Use an API key** (`ANTHROPIC_API_KEY` in `.env`). Anthropic's terms say products built on Claude Code or the Agent SDK should use API key authentication, and they don't allow serving other people through a Free, Pro, Max or Ultra plan. A Slack agent your team talks to is exactly that case. Source: [Claude Code legal and compliance](https://code.claude.com/docs/en/legal-and-compliance).
- **A subscription is for you alone.** If nobody but you ever works with your agents (for example, only as subagents in your own Claude Code), they can run on your own Claude login. Check Anthropic's current terms before relying on that; they don't settle this case explicitly.
- **No key set?** `claude` falls back to whatever login is on the machine. `ask`, the automation runner and the Slack receiver print a warning when `ANTHROPIC_API_KEY` is missing, so this never happens silently.

Set a spend limit for the key in the Anthropic Console. Every turn's cost is logged in `logs/agents/runs.jsonl` and `logs/runs.jsonl`.

---

## Work with your agents

### In Claude Code (subagents)

`npm run agents:sync` turns each agent into a Claude Code subagent with its persona, memory, teammates, report channels, a map of the knowledge base, and only the gateway tools its allowlist grants. Re-run it after changing an agent, its memory, the knowledge base or `config/gateway.yaml`; `npm run preflight` warns when the files are stale. The files are generated per machine and gitignored.

**In every project.** To use your agents in any folder you open in Claude Code (a design sandbox, an app, another repo):

```bash
npm run agents:sync -- --user
```

This writes the subagents to `~/.claude/agents/` and prints one `claude mcp add --scope user gateway …` command. Run it once, so your agents reach their tools from any project. Their knowledge base, memory and skills stay in this repo.

Inside an interactive Claude Code session, the person at the keyboard approves edits and outside reads as usual. The subagent's tool list limits what it can reach.

### From your terminal

```bash
npm run ask -- scout "What plans do we sell?"
npm run ask -- scout "Does the pricing in this README match our docs?" --in ~/code/my-app
npm run ask -- quill "Tighten the landing page copy" --in ~/code/site --allow-edits
npm run ask -- scout "anything" --show-prompt     # print the prompt and tools, run nothing
```

- `--in <folder>`: the agent works in that folder and can still read its home in this repo (knowledge base, memory, skills).
- `--allow-edits`: it may change files inside that folder. Without it, the agent only reads.

This is a headless run: anything outside the agent's allowlist is denied, never asked.

### From your own app

Any Node app can run an agent through the same core:

```js
import { runAgent } from "/path/to/baseline-agents/core/index.mjs";

const r = await runAgent({
  slug: "scout",
  prompt: "Summarize what changed in our pricing page",
  cwd: "/path/to/your/project", // optional: where the agent works
  allowEdits: false,
});
console.log(r.ok ? r.text : r.reason);
```

The agent behaves exactly as it does in Claude Code or Slack, and can report its result to a channel with `post_report`.

### Report back to a channel

Name your channels once in `config/channels.yaml`:

```yaml
channels:
  general:
    description: Where agents share finished work with the whole team
    slack: "${SLACK_CHANNEL_GENERAL}"   # channel id from .env
```

Give each agent the channels it may post to with `"reportsTo": ["general"]` in `agents/agents.json`, and allow `post_report` in its gateway caller. Wherever the agent runs, it can then post one finished result with the gateway's `post_report` tool: a design done in your project, a decision, a report. If the channel isn't connected yet, the tool says so and the agent hands you the text instead.

The gateway decides who is posting, not the agent: an agent posts only as itself, an automation only as its `report.as`, and only to channels on its own list.

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
     "canEdit": true,
     "reportsTo": ["general"],
     "slackUserId": null
   }
   ```
   - The slug (`quill`) names its memory folder, its subagent and its Slack secrets. Keep it lowercase with dashes.
   - `model` is an alias (`haiku`, `sonnet`, `opus`). Long or design- and debug-shaped requests escalate to `opus` automatically.
   - `caller` is its identity in `config/gateway.yaml`. The `slack-` prefix is a convention; it applies on every surface.
   - `canEdit` lets its Claude Code subagent edit files (the person still approves).
2. **Write its persona** in `agents/personas/quill.md`: who it is, what it does, what it never does, how it talks. Use `agents/personas/scout.md` as the pattern. Don't list teammates; every agent gets the live roster on each turn.
3. **Seed its memory**: create `memory/quill/MEMORY.md` (a heading is enough to start). See [Memory](#memory).
4. **Grant its tools** in `config/gateway.yaml`:
   ```yaml
   slack-quill:
     allow: [kb_search, kb_read_page, kb_list_pages, list_skills, read_skill, read_file, post_report]
   ```
5. **Check it and try it**:
   ```bash
   npm run preflight
   npm run agents:sync
   npm run ask -- quill "Draft a two-line announcement for our new support hours."
   ```

Connect it to Slack later if you want: see [Slack (optional)](#slack-optional).

---

## Knowledge base

`kb/` holds the facts your agents share: what your company is, what was decided, how things work. On every turn each agent gets a map of it (`kb/log.md` plus every `kb/<category>/index.md`), then reads the real pages before answering. Agents are told never to state a fact they didn't read this turn.

- One page per topic: `kb/<category>/<page>.md`, with the frontmatter in `kb/README.md`.
- One line per page in `kb/<category>/index.md`. This is what agents see in their map.
- One line per change in `kb/log.md`, newest first. The kb-digest automation reads it.

Write pages so an agent can answer from the page alone: exact names, numbers, steps, and a **Gotchas** section for what went wrong before.

## Skills

A skill is a playbook in `.claude/skills/<name>/SKILL.md`: frontmatter with a `name` and a `description` that says *when* to use it, then the procedure. Agents load skills with Claude Code's Skill tool, or with the gateway's `read_skill` when they're working in another folder. Automations list the skills they may use under `skills:` and must grant `"Skill"`.

`.claude/skills/kb-digest/SKILL.md` is the example. Keep each skill to one workflow, and put the procedure in the skill rather than in an automation's prompt, so every surface follows the same steps.

## Memory

`memory/<slug>/MEMORY.md` holds one agent's standing preferences and corrections: "always cite the page", "never quote prices to customers". It goes into that agent's prompt on every surface (capped at 4,000 characters), one line per entry, each pointing at a small file with the detail. See `memory/README.md`.

Memory is for *how an agent works*. *What your company knows* goes in `kb/`, where every agent can read it.

## Automations

An automation is a scheduled, headless agent run. The example in `automations/automations.yaml`:

```yaml
kb-digest:
  prompt_file: automations/prompts/kb-digest.md   # thin: "invoke the kb-digest skill"
  schedule:
    - { weekday: 1, hour: 9, minute: 0 }          # Mondays 09:00, machine local time
  allowed_tools: ["Read(./**)", "Glob(./**)", "Grep(./**)", "Edit(./files/**)", "Skill", "mcp__gateway"]
  skills: [kb-digest]
  max_runtime: 300        # seconds
  max_runs_per_day: 2     # scheduled runs; manual runs bypass it
  max_turns: 20
  agent_triggerable: true # agents may run it with the trigger_automation tool
  report:
    as: scout             # posts as Scout
    to: digest            # channel alias from config/channels.yaml
```

- Run one by hand: `npm run automation -- kb-digest`.
- Every run appends a row to `logs/runs.jsonl` and saves its transcript to `logs/automations/<name>/`.
- A failed run writes `logs/LAST_FAILURE.md` (removed by the next success) and, if `ALERT_CHANNEL_ID` and `ALERT_POST_AS` are set, posts an alert to Slack. A run that succeeds but hits 5 or more permission denials is flagged as **degrading**: its prompt asks for something its tools don't allow.
- Give the automation its own caller entry in `config/gateway.yaml` (the caller name is the automation's name).
- `npm run preflight` catches mismatches before they cost a run: missing prompt or skill files, a skill without the `Skill` grant, a report target the gateway doesn't allow, a `git` command in a prompt that `allowed_tools` doesn't grant.

### Put them on a schedule

```bash
npm run schedule            # show what would be installed
npm run schedule:install    # install (launchd on macOS, systemd user timers on Linux)
```

Nothing runs on a schedule until you install. Re-run `schedule:install` after changing a schedule; it also removes jobs for automations you deleted. On Linux, run `loginctl enable-linger $USER` once so jobs run while you're logged out.

---

## Slack (optional)

Each agent can be its own Slack app, with its own name, avatar and @mention. Your team mentions it in a channel or DMs it, and it answers in a thread, keeping the thread's context. Without Slack, everything above still works.

1. **Get a public HTTPS address** that forwards to `127.0.0.1:8790`.
   - Testing: a tunnel (for example `cloudflared tunnel --url http://127.0.0.1:8790`) gives you a temporary `https://…` host.
   - Running for real: a server with a domain and Caddy. `infra/Caddyfile.example` exposes only `/slack/events/*`.
2. **Start the receiver**, and keep it running (`npm run receiver:install` installs it as a service):
   ```bash
   npm run receiver
   ```
3. **Create the Slack app.** At [api.slack.com/apps](https://api.slack.com/apps), choose *Create New App*, then *From a manifest*, and paste `infra/slack-app-manifest.yaml` with `AGENT_NAME` = `Scout`, `AGENT_SLUG` = `scout` and `YOUR_PUBLIC_HOST` = your host. Slack pings the URL straight away; the receiver answers that ping even before you add credentials.
4. **Install the app** to your workspace, then copy two values into `.env`:
   - *Basic Information*, *Signing Secret* → `SLACK_SCOUT_SIGNING_SECRET=`
   - *OAuth & Permissions*, *Bot User OAuth Token* (`xoxb-…`) → `SLACK_SCOUT_BOT_TOKEN=`

   No restart needed: the receiver re-reads `.env` on every event.
5. **Copy the agent's Slack member ID** (open the bot's profile in Slack, then *Copy member ID*) into `agents/agents.json` as `"slackUserId"`. Other agents need it to mention Scout.
6. **Invite Scout** to a channel (`/invite @Scout`) and mention it: `@Scout what plans do we sell?`

You'll see a 👀 reaction within a second, then the answer in a thread.

**Report channels in Slack.** Put channel ids in `.env` (`SLACK_CHANNEL_GENERAL=C0123…`) and invite the agent to those channels. `post_report` posts with that agent's bot token.

**Agents working together in Slack.** Agents hand work to each other with real mentions. Each agent's Slack prompt carries the roster with mention IDs and a hand-off rule. Bot-to-bot mentions in one thread are capped at 4 hops (`SLACK_BOT_HOP_CAP`), so two agents can't loop forever. An agent mentioned by another bot deep in a thread may stay silent; a human mention always gets an answer.

---

## Tools and permissions

Agents start with read-only access to the folder they work in (`Read(./**)`), skills, and the gateway. Everything else is opt-in.

**The gateway** (`config/gateway.yaml`) is the one door to external tools:

- `upstreams`: the MCP servers your agents may reach (GitHub, a CRM, a docs server). Commented examples are included. Each server's tools appear as `<prefix>_<tool>`.
- `callers.<name>.allow`: globs of tools each agent or automation may use. A caller that isn't listed sees nothing.
- `hard_deny`: tools that must not exist for anyone, you included. The default denies anything matching `*_send_*`, `*_delete_*`, `*_trash_*` and `github_merge_*`. Agents draft; people send.
- `read_only`: for an upstream named here, only tools matching its regex exist, including any it adds later.
- `session_only`: tools only you, at your own terminal, can use (for example a logged-in browser).
- `github`: every GitHub call must name a repo on `repo_allowlist` under `owner`; account-wide searches are denied.

The gateway's own file tools can write to `kb/`, `files/`, `memory/` and `.claude/skills/`, and never to `agents/`, `config/`, `automations/`, `core/`, `gateway/`, `slack/`, `scripts/`, `infra/` or `.claude/settings.json`. An agent can't edit the files that decide what it may do.

Run `npm run scope-test` after every change: it tests the guards against a fixture, then checks invariants on your own config. `npm run smoke-test -- slack-scout` boots the real gateway as that caller and lists exactly what it sees.

### Let an agent work in a repo

Clone the repo under `workspaces/` (gitignored), then add it to the agent's entry:

```json
"workRepos": {
  "website": { "path": "workspaces/website", "repo": "your-org/website", "autoMerge": false }
}
```

In headless runs (Slack, `ask`, automations), the agent gains file writes inside `workspaces/website/` only, and `git -C workspaces/website <status|add|commit|checkout|switch|branch|diff|log|push|fetch|pull|rm>`. Never `reset`, `clean`, `rebase` or `merge`. It works on a branch, pushes, and opens a pull request (grant `github_create_pull_request` in its gateway caller and add the repo to `github.repo_allowlist`). With `"autoMerge": true` it may also run `gh pr merge --auto`. **Only turn that on for a repo with branch protection and a required CI check.** Without a check, auto-merge is an unreviewed merge to whatever deploys from main.

---

## Logs

All local, all gitignored, under `logs/`:

| File | What it tells you |
|---|---|
| `agents/runs.jsonl` | one row per agent turn on any surface: agent, surface, folder, model, ok, cost, tokens |
| `agents/failures.jsonl` | failed turns, with the tail of Claude's stderr |
| `runs.jsonl` | one row per automation run: status, denials, duration, cost |
| `automations/<name>/*.json` | the full transcript of each automation run |
| `LAST_FAILURE.md` | the latest automation failure (gone after the next success) |
| `toolcalls.jsonl` | every gateway tool call: caller, tool, ok, time |
| `slack-posts.jsonl` | a receipt for every confirmed Slack post |
| `slack-agent/sessions.json` | Slack thread to Claude session, for thread memory |
| `scheduler/*.log` | output of scheduled jobs and the installed receiver |

## Troubleshooting

- **The subagent doesn't show up in Claude Code.** Run `npm run agents:sync` and restart Claude Code in that folder. For other projects, use `-- --user` and run the printed `claude mcp add` command once.
- **"turn failed" from `ask`, or "hit an error" in Slack.** Read the last line of `logs/agents/failures.jsonl`. An auth error means there's no valid credential: set `ANTHROPIC_API_KEY` in `.env`. Test with `npm run ask -- scout "hi"`, not with `claude` in your own shell, which uses your interactive login.
- **An agent says a tool isn't available.** It's not in that agent's caller in `config/gateway.yaml`, or the upstream didn't connect (the gateway prints `<prefix> unavailable` on stderr). `npm run smoke-test -- slack-<slug>` shows exactly what it sees.
- **A report didn't post.** `post_report` says why: the channel isn't in the agent's `reportsTo`, its id is empty in `.env`, or the agent's Slack bot token is missing or not in that channel.
- **An automation logs `ok` but did nothing.** Check `denials` in `logs/runs.jsonl`. A prompt asking for a command its `allowed_tools` doesn't grant fails quietly, one denial at a time.
- **Slack: the agent never replies.** Check the receiver's output. `401` means a wrong signing secret, `503` means that agent's two Slack values are missing from `.env`, and nothing logged at all means Slack isn't reaching your host.

## Security

Treat your agents like a new teammate with keys to exactly what you gave them, and no more.

- **Anyone who can message an agent can steer it.** That includes everyone in the Slack channels it's in, and the content of every page and file it reads (prompt injection). The allowlist in `config/gateway.yaml` is the real boundary, not the persona. Grant each agent only the tools its job needs.
- **Keep destructive and outbound actions absent.** The default `hard_deny` removes send, delete, trash and merge tools for every caller. Add anything else that must never happen without a person.
- **Repo work goes through pull requests.** `autoMerge` belongs only on repos with branch protection and a required CI check.
- **Secrets stay in `.env`.** It's gitignored and the gateway refuses to read it. No agent turn ever receives a Slack token; posting goes through `post_report`.
- **Data leaves your machine** to Anthropic on every turn, to Slack for every reply or report, and to OpenRouter only if you set `OPENROUTER_API_KEY` (it enables the `second_opinion` tool). Don't put anything in `kb/` you wouldn't send to those services.
- **Review `logs/toolcalls.jsonl`** now and then. Every gateway call is recorded with the caller and the tool.

## Gotchas

- **Write rules are `Edit(...)` rules.** In Claude Code, `Edit(path)` governs file writes; a `Write(path)` grant is silently ignored.
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
config/          gateway.yaml (tools and permissions), channels.yaml (report channels)
core/            the agent core: prompt, tools, runner (no Slack)
gateway/         the MCP gateway
slack/           the optional Slack adapter: receiver, turn handler, posting
scripts/         ask, agents-sync, run-automation, preflight, schedule
infra/           Slack app manifest, Caddy example
files/           automation outputs (gitignored)
logs/            runtime logs (gitignored)
```

## License

MIT. See `LICENSE`. Copy it, change it, build your own agents on it.
