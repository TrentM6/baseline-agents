---
name: kb-digest
description: Write the weekly knowledge-base digest (what was filed or updated in kb/ in the last 7 days) to files/kb-digest.md, and post it to the team's digest channel when one is connected. Use when asked for the KB digest, "what changed in the knowledge base this week", or when the kb-digest automation runs.
---

# KB digest

Produces `files/kb-digest.md`: a short, scannable list of what changed in the knowledge base in the last 7 days, so the team sees new knowledge without reading `kb/log.md`.

## Procedure

1. Read `kb/log.md`. Keep the lines dated within the last 7 days (today's date is in your context; if not, use the newest date in the log as "today").
2. For each kept line, read the page it names (`kb/<category>/<slug>.md`) and pull its `title` and `description` from the frontmatter. If a page no longer exists, list it under "Missing pages" instead.
3. Write `files/kb-digest.md` with exactly this shape:

   ```markdown
   # Knowledge base, week of YYYY-MM-DD

   **N pages filed or updated.**

   ## New and updated
   - **Title**: description (`kb/category/slug.md`)

   ## Missing pages
   - `kb/category/slug.md`: in the log but not on disk
   ```

   Drop the "Missing pages" section when it's empty. With nothing in the last 7 days, write the heading plus one line: `No pages filed or updated this week.`
4. Post the digest with the gateway tool `mcp__gateway__post_report`: `to` = the channel your instructions name (default `digest`), `text` = the file's content. If it says the channel isn't connected, that's fine: the file is the deliverable. Say which happened in your final message.
5. Final message: one line with the page count, the output path, and whether it was posted.

## Gotchas

- Never invent pages or descriptions. Every bullet comes from a file you read.
- The digest is a pointer, not a summary of each page: one line per page.
