# memory/ — per-agent working memory

One folder per agent slug in `agents/agents.json`. The runner injects `memory/<slug>/MEMORY.md` into that agent's system prompt on every turn.

## What goes here

How ONE agent works: standing preferences, corrections, format rules. Each entry is one line in `MEMORY.md` pointing at a small file with the detail:

```
memory/scout/
  MEMORY.md                    # index: one line per entry
  feedback_cite-the-page.md    # the detail for one entry
```

Prefix the detail files by kind: `feedback_` (a correction someone gave), `reference_` (where something lives), `project_` (an ongoing piece of work).

## What never goes here

- Company knowledge (what was decided, how a product works). That goes in `kb/`, where every agent can read it. Memory keeps the *habit*; the *fact* lives once, in the KB.
- Secrets, tokens, API keys, personal or HR-sensitive information, raw private correspondence.

## Rules

- Only `MEMORY.md` is loaded, capped at 4,000 characters. Keep the index tight.
- A missing folder or empty `MEMORY.md` is not an error: the agent just runs without memory. Seed the folder when you add an agent, or it will look inactive rather than broken.
- Change memory the way you change code: edit, review, commit. If you let agents edit their own memory, do it through a pull request so a human reads every change before it takes effect.
