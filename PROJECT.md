# baseline-agents

Goal: A team of agents that works wherever you do, each with its own skills, memory and schedule. Open source (MIT), set up through config.

## Now
- Public GitHub repo, MIT licensed: TrentM6/baseline-agents
- Local-first: agents run as Claude Code subagents (`agents:sync`), from the terminal (`ask`, also inside other folders with `--in`), from apps (`core/index.mjs`), and on a schedule
- Slack is an optional adapter; `post_report` lets an agent on any surface post a finished result to a named channel
- Verified locally: offline suites pass; real turns via `ask`, `ask --in`, a Claude Code subagent, and the kb-digest automation

## Next
- Test the full Slack path in a fresh workspace (manifest, tunnel, mention, threaded reply, post_report)
- Run setup on a clean Linux box and fix whatever the README misses
- A second report adapter beyond Slack (email draft or webhook)
- An example agent that does repo work (workRepos + PR flow)
- A remote (HTTP) gateway transport for MCP clients that can't spawn a process

## Log
- 2026-11-22: Created the repo: Slack runtime, MCP gateway, automation runner, scheduler, example agent and automation
- 2026-11-22: Pushed to GitHub, added the MIT license, made the repo public
- 2026-11-22: Restructured local-first: agent core split from Slack, Claude Code subagents, agents in other folders, post_report for reporting from any surface
