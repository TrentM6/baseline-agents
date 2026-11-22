# Advanced: agents that change code in a repo

Optional. Most agents never need this. Use it when you want an agent to make real changes in a git repository during headless runs (from `npm run ask`, an automation, or Slack) and hand them back as pull requests.

## What the agent gets

Clone the repo under `workspaces/` (gitignored), then add it to the agent's entry in `agents/agents.json`:

```json
"workRepos": {
  "website": { "path": "workspaces/website", "repo": "your-org/website" }
}
```

In headless runs whose working folder is this repo, the agent gains:

- File writes inside `workspaces/website/` only (`Edit(./workspaces/website/**)`). Add `"writePaths": ["docs", "src/content"]` to narrow that further.
- `git -C workspaces/website <cmd>` for exactly these subcommands: `status`, `add`, `commit`, `checkout`, `switch`, `branch`, `diff`, `log`, `push`, `fetch`, `pull`, `rm`. Never `reset`, `clean`, `rebase` or `merge`.
- `gh pr create --repo your-org/website …` to open a pull request.

Its instructions tell it to sync `main` first, work on a new `work/<agent>-<desc>` branch, push it, and open a pull request. It never commits to `main`.

You need [`gh`](https://cli.github.com) installed and signed in with access to that repo (or set `GH_BIN` to its path).

## Auto-merge

```json
"website": { "path": "workspaces/website", "repo": "your-org/website", "autoMerge": true }
```

With `autoMerge`, the agent may also run `gh pr merge --repo your-org/website <PR#> --auto --squash` and `gh pr view` to confirm the merge landed. GitHub then merges the pull request as soon as the required checks pass.

**Only turn this on for a repo with branch protection on `main` and a required CI check.** Without a check, auto-merge is an unreviewed merge straight to whatever deploys from `main`.

## Why the commands look like this

- **`git -C <path>`, never `cd`.** Claude Code's `Bash(prefix:*)` permissions match the literal start of a command. `git -C workspaces/website commit` matches the grant; `cd workspaces/website && git commit` doesn't, and would let git touch whichever repo it lands in.
- **`--repo` right after the subcommand** (`gh pr merge --repo …`) for the same reason: the grant is a prefix match.
- **Repo grants apply only when the run's working folder is this repo.** With `npm run ask -- … --in <folder>`, use `--allow-edits` instead; that grants edits inside that folder and nothing else.

## Interactive use

As a Claude Code subagent, an agent with `workRepos` (or `"canEdit": true`) gets `Edit` and `Write`. Your own Claude Code permission settings still decide what it may do without asking.
