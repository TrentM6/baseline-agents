# kb/ — your knowledge base

Everything your agents know lives here, as markdown. Agents get a map of it on every turn (`kb/log.md` plus each `kb/<category>/index.md`) and read the real pages before answering.

## Layout

- `kb/<category>/<page>.md` — one page per topic. Pick categories that fit your company (`company`, `products`, `customers`, `operations`, `playbooks`, `decisions`, …).
- `kb/<category>/index.md` — one line per page: `- [Title](page.md) — one-line description`. This is what the agent's map shows, so keep it current.
- `kb/log.md` — newest first, one line per page filed or updated.

## Page format

```markdown
---
type: note | decision | reference | playbook | report
title: Short descriptive title
description: One-line summary used in indexes and search
tags: [lowercase, kebab-case]
sources:
  - "Where this came from"
last_verified: YYYY-MM-DD
---

**TL;DR** — 2–4 bullets with the facts most readers came for.

## Real sections with the detail: names, numbers, paths, steps.

## Gotchas — what looks right but isn't.
```

Write pages so an agent can answer from the page alone. A page that reads like a summary sends the agent back to you with questions.

## Never file here

Secrets or credentials, personal or HR-sensitive information, raw private email. File the fact, cite the source.
