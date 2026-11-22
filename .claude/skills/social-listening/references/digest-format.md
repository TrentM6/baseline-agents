Contents: the daily digest template, the living landscape page template with confidence levels and shifts log, the action-candidate line format, and the carried, expiry and routing rules in one place, with a filled digest.

# Digest and landscape page

Two outputs, different by design:

- **The digest**: a dated, one-minute read of what this sweep found. Kept as a rolling feed (about 30 days), older entries roll off.
- **The landscape page**: the living, compounding synthesis. One per landscape. The single source of truth for what's established, what's a signal and what's only being watched.

## Digest template

```markdown
# <Weekday, D Month>: <landscape> pulse

## What practitioners are doing
- **<Named person, account or repo>**: <what they're doing, and why it's worth knowing>. [Source](link)

## Tools and comparisons
- **<Short label>**: <which tools are being combined or compared, and the verdict>. [Source](link)

## Recurring needs
- **<Short label>**: <the need, and where else it showed up>. [Source](link), [Source](link)

## On the radar
- <one line, not yet a full finding>

## Action candidates
### Gaps
- <lines, or "Nothing currently active.">
### Inspiration
- <lines, or "Nothing currently active.">
```

Rules for every line:

- `**Label**: one or two sentences. [Source](link)`. Links inline, never in a footer.
- Name the source person or project when the source allows.
- Omit empty category headings. Action candidates always appears.
- The date heading uses the same format as the daily brief, so the two read as one system.

## Action-candidate line

```
- **<what>**: <finding; for inspiration, the transferable mechanism> → <route: a named product, or "candidate for something new">, <why now>. [Source](link) (carried, sweep N/3)
```

- New this sweep: no marker.
- Carried: `(carried, sweep N/3)`, where N counts the sweeps it has survived unrouted.
- A section with nothing new opens with: `- Carried from earlier sweeps: <n> items, nothing new today.` and still lists them.
- Effect claims resting on one source carry their basis inline: `(author's framing; one run; no comparison)`.

## Expiry and routing

| Event | What happens |
|---|---|
| Survives a sweep unrouted | N goes up by one |
| Reaches 3/3 | Removed from the active list and the page |
| Picked up, dismissed or folded into a project | Removed the same run, replaced by `Routed <date>, to <where>` or `Dismissed <date>` |
| Resurfaces later with new sources | Re-enters at sweep 1 |

Detect routing from a record the run can read: a new project file, a tracker entry, an issue. A routed item that re-posts is the failure these rules exist to stop.

## Landscape page template

```markdown
---
type: reference
title: <Landscape> landscape
description: Living synthesis of <landscape>: what's established, what's a signal, what's being watched, and what it means.
tags: [landscape, <topic>]
sources:
  - "Daily pulse digests, <start date> onward"
last_verified: <date>
---

**TL;DR**
- <the state of play in two to four bullets>

## Established
- **<theme>**: <one line>. First seen <date>; recurring since. [Sources](link)

## Signals
- **<theme>**: <one line>. Seen <n> times since <date>. [Sources](link)

## Watching
- **<theme>**: <one line>. Single data point, <date>. [Source](link)

## Recurring needs
- **<need>**: <one line>. Seen <n> times. [Sources](link)

## Action candidates
### Gaps
### Inspiration

## Implications
<rewritten weekly: what this means for what the owner builds, says or watches>

## Shifts log
- <date>: <what changed, from what to what>
```

Confidence moves one step at a time: watch, then signal (seen repeatedly), then established. A watch that never recurs is pruned at the weekly sharpen. A changed fact overwrites its line and gets a dated shifts-log entry; the page never keeps two versions of one fact.

## Order of operations

Reconcile the landscape page first, then copy its current Action candidates section into the digest. The page is the source of truth; the digest mirrors it, so the reader never has to open the page to see what's active.

## Filled digest

```markdown
# Tuesday, 24 November: product design tools pulse

## What practitioners are doing
- **A design-systems lead at a fintech**: published the token pipeline that ships one source of tokens to web, iOS and Android, with the build scripts. Worth knowing as the first full public example at that scale. [Source](link)

## Tools and comparisons
- **Prototyping in code vs in the design tool**: a long forum thread splits roughly evenly; the code side cites real data and states, the tool side cites speed for early ideas. Contested. [Source](link)

## Recurring needs
- **Visual diff for components**: designers asking for a way to see what changed between two library versions. Third time this month, also [here](link) and [here](link). [Source](link)

## Action candidates
### Gaps
- **Component version diff**: recurring ask for a visual changelog of library releases → candidate for something new, three sources in a month. [Source](link) (carried, sweep 2/3)
### Inspiration
- **Tokens as one build step**: one config compiled to every platform's native format, versioned with the library → the design system's token export, the team already maintains three hand-written exports. [Source](link)
```
