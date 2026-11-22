# baseline-agents

Goal: A team of agents that works for you in Slack, each with its own skills, memory and schedule — open source, set up through config.

## Now
- First version built: Slack receiver + runner, MCP gateway with per-caller policy, automation runner with caps and alerts, scheduler installer (launchd/systemd), example agent (Scout) and automation (kb-digest)
- Private GitHub repo: TrentM6/baseline-agents
- Verified locally: offline test suite passes, one real Scout turn and one real kb-digest run completed with repo-scoped tools

## Next
- Choose a license before making the repo public
- Test the full Slack path in a fresh workspace (manifest → tunnel → mention → threaded reply)
- Run setup on a clean Linux box and fix whatever the README misses
- Add a remote (HTTP) gateway transport for MCP clients that can't spawn a process
- Add a second example agent that does repo work (workRepos + PR flow)

## Log
- 2026-11-22 — Created the repo: Slack runtime, MCP gateway, automation runner, scheduler, example agent and automation; first local commit
- 2026-11-22 — Pushed to a private GitHub repo (TrentM6/baseline-agents)
