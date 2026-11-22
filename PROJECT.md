# baseline-agents

Goal: A framework anyone can run to operate their own team of Claude agents in Slack and on a schedule, with skills, per-agent memory, a knowledge base, and a permissioned MCP tool gateway.

## Now
- First version built: Slack receiver + runner, MCP gateway with per-caller policy, automation runner with caps and alerts, scheduler installer (launchd/systemd), example agent (Scout) and automation (kb-digest)
- Verified locally: offline test suite passes, one real Scout turn and one real kb-digest run completed with repo-scoped tools

## Next
- Decide repo visibility (private or public) and license, then create the GitHub repo and push
- Test the full Slack path in a fresh workspace (manifest → tunnel → mention → threaded reply)
- Run setup on a clean Linux box and fix whatever the README misses
- Add a remote (HTTP) gateway transport for MCP clients that can't spawn a process
- Add a second example agent that does repo work (workRepos + PR flow)

## Log
- 2026-11-22 — Created the repo; framework copied and generalized from the agent runtime that runs the studio's own agents; first local commit
