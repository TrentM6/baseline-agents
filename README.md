# Baseline Agents

A team of agents that works wherever you do, each with its own skills, memory and schedule.

Define an agent once: who it is, what it knows, which tools it may use, when it runs. Then work with it in Claude Code, from your terminal, inside any project, from your own app, or on a schedule. Everything runs on your machine with [Claude Code](https://docs.claude.com/en/docs/claude-code). There is no server to run and no service to sign up for beyond Claude itself.

What you get:

- **Agents defined once.** A roster in `agents/agents.json` and a persona per agent. An agent behaves the same on every surface.
- **A knowledge base.** Markdown pages in `kb/` that every agent reads before answering, and cites.
- **Skills.** Reusable playbooks in `.claude/skills/` that agents load when the work calls for one.
- **Memory.** A small per-agent file of standing preferences and corrections.
- **Schedules.** Automations that run an agent on a timer, with caps, locks, run logs and failure flags.

Optional, when you need them:

- **A tool gateway**: a safety layer between agents and their tools, with per-agent allowlists, tools nobody can use, and a log of every call. Recommended for anything unattended.
- **Reporting**: an agent working anywhere posts a finished result to a channel you name.
- **Slack**: each agent as its own Slack app that answers mentions and DMs in threads.

It ships with one example agent, **Scout**, who answers questions from your knowledge base, and one example automation, **kb-digest**, which writes a weekly summary of what changed in it.

---

## How it works

```
 agents/agents.json · agents/personas/ · memory/ · kb/ · .claude/skills/
                                   │
               ┌───────────────────┼─────────────────────┐
         Claude Code         npm run ask            your app
          subagents      (also --in any folder)   (core/index.mjs)
               └───────────────────┼─────────────────────┘
                                   │         automations on a schedule
                                   ▼
                        claude: one agent turn
                                   │
                   optional: gateway → tools, post_report → Slack
```

- `core/` turns an agent definition into a Claude Code run: its system prompt (persona, memory, teammates, knowledge-base map) and its tool allowlist.
- Each way of using an agent adds only its own etiquette. The agent is the same.
- Every run is limited to the tools it's granted. Headless runs never stop to ask: anything else is denied.

---

## Requirements

- macOS or Linux, Node.js 20 or newer.
- [Claude Code](https://docs.claude.com/en/docs/claude-code) installed (`claude` on your PATH).
- An [Anthropic API key](https://console.anthropic.com). See [Claude credentials](#claude-credentials).

---

## Quick start (about 10 minutes)

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
4. **Use your agents in Claude Code.**
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

- **Use an API key** (`ANTHROPIC_API_KEY` in `.env`). Anthropic's terms say products built on Claude Code or the Agent SDK should use API key authentication, and they don't allow serving other people through a Free, Pro, Max or Ultra plan. An agent your team talks to is exactly that case. Source: [Claude Code legal and compliance](https://code.claude.com/docs/en/legal-and-compliance).
- **A subscription is for you alone.** If nobody but you ever works with your agents (for example, only as subagents in your own Claude Code), they can run on your own Claude login. Check Anthropic's current terms before relying on that; they don't settle this case explicitly.
- **No key set?** `claude` falls back to whatever login is on the machine. `ask`, the automation runner and the Slack receiver print a warning when `ANTHROPIC_API_KEY` is missing.

Set a spend limit for the key in the Anthropic Console. Every turn's cost is logged in `logs/agents/runs.jsonl` and `logs/runs.jsonl`.

---

## Work with your agents

### In Claude Code

`npm run agents:sync` turns each agent into a Claude Code subagent with its persona, memory, teammates and a map of the knowledge base. Re-run it after changing an agent, its memory or the knowledge base; `npm run preflight` warns when the files are stale. The files are generated per machine and gitignored.

**In every project.** To use your agents in any folder you open in Claude Code:

```bash
npm run agents:sync -- --user
```

This writes the subagents to `~/.claude/agents/`. Their knowledge base, memory and skills stay in this repo, and they read them from there.

Inside an interactive Claude Code session, you approve edits and outside reads as usual. The subagent's tool list limits what it can reach.

### From your terminal

```bash
npm run ask -- scout "What plans do we sell?"
npm run ask -- scout "Does the pricing in this README match our docs?" --in ~/code/my-app
npm run ask -- quill "Tighten the landing page copy" --in ~/code/site --allow-edits
npm run ask -- scout "anything" --show-prompt     # print the prompt and tools, run nothing
```

- `--in <folder>`: the agent works in that folder and still reads its home in this repo (knowledge base, memory, skills).
- `--allow-edits`: it may change files inside that folder. Without it, the agent only reads.

This is a headless run: anything outside the agent's allowlist is denied, never asked.

### From your own app

Any Node app can run an agent through the same core:

```js
import { runAgent } from "/path/to/baseline-agents/core/index.mjs";

const r = await runAgent({
  slug: "scout",
  prompt: "Summarize what changed on our pricing page",
  cwd: "/path/to/your/project", // optional: where the agent works
  allowEdits: false,
});
console.log(r.ok ? r.text : r.reason);
```

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
     "model": "sonnet",
     "tools": ["WebSearch"],
     "canEdit": true
   }
   ```
   - The slug (`quill`) names its memory folder and its subagent. Keep it lowercase with dashes.
   - `model` is an alias (`haiku`, `sonnet`, `opus`). Long or design- and debug-shaped requests escalate to `opus` automatically.
   - `tools` adds Claude Code tools beyond reading files and loading skills, written as permission rules: `"WebSearch"`, `"Bash(npm test:*)"`, or a tool from your own MCP servers such as `"mcp__github__get_issue"`. Leave it out and the agent only reads.
   - `canEdit` lets its Claude Code subagent edit files (you still approve each edit).
2. **Write its persona** in `agents/personas/quill.md`: who it is, what it does, what it never does, how it talks. Use `agents/personas/scout.md` as the pattern. Don't list teammates; every agent gets the live roster on each turn.
3. **Seed its memory**: create `memory/quill/MEMORY.md` (a heading is enough to start). See [Memory](#memory).
4. **Check it and try it**:
   ```bash
   npm run preflight
   npm run agents:sync
   npm run ask -- quill "Draft a two-line announcement for our new support hours."
   ```

---

## Knowledge base

`kb/` holds the facts your agents share: what your company is, what was decided, how things work. On every turn each agent gets a map of it (`kb/log.md` plus every `kb/<category>/index.md`), then reads the real pages before answering. Agents are told never to state a fact they didn't read this turn.

- One page per topic: `kb/<category>/<page>.md`, with the frontmatter in `kb/README.md`.
- One line per page in `kb/<category>/index.md`. This is what agents see in their map.
- One line per change in `kb/log.md`, newest first. The kb-digest automation reads it.

Write pages so an agent can answer from the page alone: exact names, numbers, steps, and a **Gotchas** section for what went wrong before.

## Skills

A skill is a playbook in `.claude/skills/<name>/SKILL.md`: frontmatter with a `name` and a `description` that says *when* to use it, then the procedure. Agents load skills with Claude Code's Skill tool; working in another folder, they read them from this repo. Automations list the skills they may use under `skills:` and must grant `"Skill"`.

`.claude/skills/kb-digest/SKILL.md` is the example. Keep each skill to one workflow, and put the procedure in the skill rather than in an automation's prompt, so every way of running the agent follows the same steps.

## Memory

`memory/<slug>/MEMORY.md` holds one agent's standing preferences and corrections: "always cite the page", "never quote prices to customers". It goes into that agent's prompt everywhere it runs (capped at 4,000 characters), one line per entry, each pointing at a small file with the detail. See `memory/README.md`.

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
```

- Run one by hand: `npm run automation -- kb-digest`.
- Every run appends a row to `logs/runs.jsonl` and saves its transcript to `logs/automations/<name>/`.
- A failed run writes `logs/LAST_FAILURE.md`, removed by the next success. A run that succeeds but hits 5 or more permission denials is flagged as **degrading**: its prompt asks for something its tools don't allow.
- `npm run preflight` catches mismatches before they cost a run: missing prompt or skill files, a skill without the `Skill` grant, a `git` command in a prompt that `allowed_tools` doesn't grant.
- The `mcp__gateway` grant does nothing until you turn the gateway on.

### Put them on a schedule

```bash
npm run schedule            # show what would be installed
npm run schedule:install    # install (launchd on macOS, systemd user timers on Linux)
```

Nothing runs on a schedule until you install. Re-run `schedule:install` after changing a schedule; it also removes jobs for automations you deleted. On Linux, run `loginctl enable-linger $USER` once so jobs run while you're logged out.

---

## Optional: the gateway

Without the gateway, each run is limited to the tools its allowlist names, and Claude Code's own MCP servers are available to any agent you grant them to. That's enough for you working with your own agents.

Turn the gateway on when agents run unattended or for other people (schedules, Slack), or when you want one place to see and control every tool call. It is an MCP server that sits between your agents and every external tool:

- **Per-agent allowlists** in one file, `config/gateway.yaml`. A caller that isn't listed sees nothing.
- **Tools nobody can use**, you included (`hard_deny`). The default removes anything matching `*_send_*`, `*_delete_*`, `*_trash_*` and `github_merge_*`. Agents draft; people send.
- **Read-only upstreams**: for a server named under `read_only`, only tools matching its pattern exist, including any it adds later.
- **Session-only tools**: tools only you, at your own terminal, can use (for example a logged-in browser).
- **GitHub scoping**: every GitHub call must name a repo on `repo_allowlist`; account-wide searches are denied.
- **A log of every call**, by caller, in `logs/toolcalls.jsonl`.
- **Knowledge-base, skill and file tools** that any MCP client can use, with writes structurally limited to `kb/`, `files/`, `memory/` and `.claude/skills/`.
- **Reporting** with `post_report` (next section) and **`trigger_automation`**, so an agent can re-run an automation it fixed.

```bash
npm run gateway:on       # creates config/gateway.yaml from the example, writes .mcp.json
npm run scope-test       # prove the rules do what you think
npm run agents:sync      # subagents now get exactly their allowed gateway tools
npm run gateway:off      # back to standalone
```

With the gateway on, it is the only MCP server attached to headless runs, and each run's identity decides its tools: an agent is `agent-<slug>` (or its `caller` in `agents.json`), an automation is its own name. Add upstream MCP servers under `upstreams:` in `config/gateway.yaml`; commented examples are included. `npm run smoke-test -- agent-scout` boots the gateway as that caller and lists exactly what it sees.

**Cross-model review.** The gateway can also offer a `second_opinion` tool that asks a non-Claude model through OpenRouter. It's off: set `second_opinion: true` in `config/gateway.yaml` and `OPENROUTER_API_KEY` in `.env` to enable it. Anything sent to it leaves your machine for OpenRouter.

## Optional: report to a channel

Needs the gateway. An agent working anywhere, in Claude Code, from the terminal, in your app or on a schedule, can post one finished result to a named channel with the `post_report` tool: a design, a decision, a report.

1. Name your channels in `config/channels.yaml`:
   ```yaml
   channels:
     general:
       description: Where agents share finished work with the whole team
       slack: "${SLACK_CHANNEL_GENERAL}"   # channel id, from .env
   ```
2. Give each agent the channels it may post to: `"reportsTo": ["general"]` in `agents/agents.json`. An automation uses `report: { as: scout, to: digest }`.
3. Allow `post_report` for that agent in `config/gateway.yaml`.

The gateway decides who is posting, not the agent: an agent posts only as itself, an automation only as its `report.as`, and only to channels on its own list. If a channel isn't connected, the tool says so and the agent hands you the text instead. Slack is the only channel type today; connecting it needs that agent's Slack bot token (next section).

## Optional: Slack

Each agent can be its own Slack app, with its own name, avatar and @mention. Your team mentions it in a channel or DMs it, and it answers in a thread, keeping the thread's context. Slack turns run unattended for anyone in the channel, so turn the gateway on first.

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

- **Agents working together.** Agents hand work to each other with real mentions. Bot-to-bot mentions in one thread are capped at 4 hops (`SLACK_BOT_HOP_CAP`), so two agents can't loop forever. An agent mentioned by another bot deep in a thread may stay silent; a human mention always gets an answer.
- **Failure alerts.** Set `ALERT_CHANNEL_ID` and `ALERT_POST_AS` in `.env` and a failed or degrading automation posts there.

## Advanced: agents that change code

An agent can make changes in a git repo during headless runs and hand them back as pull requests, with an optional auto-merge behind your CI. See [docs/repo-work.md](docs/repo-work.md).

---

## Logs

All local, all gitignored, under `logs/`:

| File | What it tells you |
|---|---|
| `agents/runs.jsonl` | one row per headless agent turn: agent, surface, folder, model, ok, cost, tokens |
| `agents/failures.jsonl` | failed turns, with the tail of Claude's stderr |
| `runs.jsonl` | one row per automation run: status, denials, duration, cost |
| `automations/<name>/*.json` | the full transcript of each automation run |
| `LAST_FAILURE.md` | the latest automation failure (gone after the next success) |
| `toolcalls.jsonl` | every gateway tool call: caller, tool, ok, time (gateway on) |
| `slack-posts.jsonl` | a receipt for every confirmed Slack post (Slack on) |
| `slack-agent/sessions.json` | Slack thread to Claude session, for thread memory (Slack on) |
| `scheduler/*.log` | output of scheduled jobs and the installed receiver |

## Troubleshooting

- **The subagent doesn't show up in Claude Code.** Run `npm run agents:sync` and restart Claude Code in that folder. For other projects, use `npm run agents:sync -- --user`.
- **"turn failed" from `ask`.** Read the last line of `logs/agents/failures.jsonl`. An auth error means there's no valid credential: set `ANTHROPIC_API_KEY` in `.env`. Test with `npm run ask -- scout "hi"`, not with `claude` in your own shell, which uses your interactive login.
- **An agent says a tool isn't available.** It isn't in the agent's `tools` (gateway off), or in its caller in `config/gateway.yaml` (gateway on). `npm run ask -- <agent> "x" --show-prompt` prints its exact tool list.
- **An automation logs `ok` but did nothing.** Check `denials` in `logs/runs.jsonl`. A prompt asking for a command its `allowed_tools` doesn't grant fails quietly, one denial at a time.
- **A report didn't post.** `post_report` says why: the gateway is off, the channel isn't in the agent's `reportsTo`, its id is empty in `.env`, or the agent's Slack bot token is missing or not in that channel.
- **Slack: the agent never replies.** Check the receiver's output. `401` means a wrong signing secret, `503` means that agent's two Slack values are missing from `.env`, and nothing logged at all means Slack isn't reaching your host.

## Security

Treat your agents like a new teammate with keys to exactly what you gave them, and no more.

- **Anyone who can message an agent can steer it.** That includes everyone in a Slack channel it's in, and the content of every page and file it reads (prompt injection). The tool allowlist is the real boundary, not the persona. Grant each agent only the tools its job needs, and turn the gateway on before agents work for other people.
- **Keep destructive and outbound actions absent.** With the gateway on, the default `hard_deny` removes send, delete, trash and merge tools for every caller.
- **Repo work goes through pull requests.** Auto-merge belongs only on repos with branch protection and a required CI check.
- **Secrets stay in `.env`.** It's gitignored, and the gateway refuses to read it. No agent turn receives a Slack token.
- **Data leaves your machine** to Anthropic on every turn, and to Slack or OpenRouter only if you turn those on. Don't put anything in `kb/` you wouldn't send to those services.

## Gotchas

- **Write rules are `Edit(...)` rules.** In Claude Code, `Edit(path)` governs file writes; a `Write(path)` grant is silently ignored.
- **Scope file reads.** A bare `"Read"` grant reaches your whole filesystem. Use `Read(./**)`.
- **Don't put this repo inside another Claude Code project.** Claude Code loads `CLAUDE.md` files from parent folders into every agent turn, and agents will try to read the parent project's files.
- **Headless runs can't ask.** Anything outside an allowlist is denied, never queued for approval. Name every command a prompt or skill needs, and run `npm run preflight`.

## Layout

```
agents/          agents.json (the roster) and personas/
memory/          one folder per agent: MEMORY.md + detail files
kb/              the knowledge base
.claude/skills/  skills
automations/     automations.yaml and prompts/
core/            the agent core: prompt, tools, one turn
scripts/         ask, agents-sync, run-automation, preflight, schedule, gateway on/off
docs/            advanced guides (repo work)
config/          optional: gateway.example.yaml, channels.yaml
gateway/         optional: the MCP gateway
slack/           optional: the Slack adapter
infra/           optional: Slack app manifest, Caddy example
files/           automation outputs (gitignored)
logs/            runtime logs (gitignored)
```

## License

MIT. See `LICENSE`. Copy it, change it, build your own agents on it.
