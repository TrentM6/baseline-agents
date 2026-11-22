---
name: daily-brief
description: >-
  Builds and refreshes a personal daily brief, as a document, a message or an "at a glance"
  view: what happened since the last one, what's waiting, and what to do today. Covers the fixed
  shape, the date as the orienting heading, computed time buckets, items that each carry their
  action, the morning build versus midday refresh, freshness, carrying unresolved items forward,
  and what to leave out when a source is down. Use when building a morning brief, a daily
  summary, a "today" page or home screen, a stand-up digest for one person, or when refreshing
  any of them during the day. Do not build or restyle a daily brief or day-at-a-glance view, or
  write status notes about missing data into one, without loading this skill first.
license: MIT
metadata:
  author: Baseline Studio
  version: 1.0.0
  group: Agents
  pairs-with: [social-listening]
---

# Daily brief

The brief is where someone starts the day. It answers three questions in under three minutes: what happened, what's waiting for me, and what should I do. Everything in it is current, and everything in it can be acted on from where it sits.

The governing principle: **show less, keep it live.** A shorter brief that's entirely current beats a complete one padded with notes about what didn't load.

## The bar

A reviewer accepts a brief when:

- The date is the first thing read, in full, and the content underneath is that day's.
- Every item is one line in the same shape, and carries the link or control to act on it.
- "Needs you" holds only new things the reader must act on, and is empty when nothing is.
- Times like "overnight" and "this morning" were computed from timestamps in the reader's timezone.
- Nothing in it describes the brief's own plumbing: no outage notes, no staleness apologies, no "all clear".
- It looks the same tomorrow: same sections, same order, same item format.

A reviewer sends it back when it shows yesterday's content under today's date, re-alarms the same unresolved item every morning, lists things the reader can't act on from the brief, or opens with a subtitle that says nothing.

## Rules

### Shape

1. **Fixed sections, fixed order.** Use these, omitting any with nothing real:
   1. **Needs you**: new items that need the reader's action today (an approval, a reply, a failure only they can fix).
   2. **Since yesterday**: what happened, grouped by time bucket.
   3. **Waiting**: messages, email, reviews and requests, one line each.
   4. **Today**: calendar, deadlines, the plan.
   5. **Carried forward**: still-open items from earlier days.
   The same shape every day is what lets the reader scan it; a section that moves around has to be found again.
2. **The date leads, in full.** "Monday, 23 November" as the heading, not a small label. Orienting the reader to the day is primary information, not decoration. A personal title is fine ("Your day, Monday 23 November") as long as the date is in it at heading size.
3. **One item format everywhere.** `**Label**: one sentence. [action](link)`. Bold label, colon, at most two sentences, the action link last. If one section bolds its labels and another doesn't, the brief reads as assembled from parts.
4. **Every item carries its action.** An approval has approve and deny right there. An email links to its thread. A to-do links to where it gets done, or starts the work. A shipped file or page links to it. An item the reader can't act on from the brief is either context for another item or noise.
5. **Links inline, never on their own line.** A bare URL on its own line unfurls into a preview card in most chat tools and breaks the scan.
6. **Short enough for three minutes.** At most five items under Needs you, at most two sentences per item, roughly 300 words in total. If it's longer, the filter is too loose.

### Time and freshness

7. **Compute every "when"; never eyeball it.** Convert each timestamp to the reader's timezone, then bucket it: **overnight** (21:00 to 05:00), **this morning** (05:00 to noon), **today** (noon to now), **yesterday**, **N days ago**. Do it with code, not mental arithmetic: a 02:00 UTC event is the previous evening in New York, and the brief once called overnight work "an hour ago". Fetch timestamps with their offsets; a log format that strips the time makes this impossible.
8. **Never show yesterday's content under today's date.** Decide the mode from the date already in the brief. If it isn't today's date, build a fresh one (or, until the build runs, title the old one with its own date). If it is today's, refresh only the live sections.
9. **Refresh during the day, not just at 9am.** People open the brief before the morning build and again at 3pm. Refresh the live sections (Needs you, Waiting) on a schedule or on open; leave Since yesterday and Carried forward to the morning build.
10. **Say when it was updated, once.** A quiet "Updated 11:45" next to the date answers "is this current?" without a sentence about it. It's the one meta line that carries information the reader can't get otherwise.

### What goes in, what stays out

11. **Needs you is for new and actionable.** An item unresolved for 24 hours moves to Carried forward as a quiet line with its link. Re-alarming the same thing every morning trains the reader to skip the whole section.
12. **Don't duplicate a live signal.** If another surface on the same screen already shows the open-review count or failed jobs live, the brief adds only what that surface can't: why it matters, what to do. Two independently computed versions of the same fact drift, and the reader sees two cards for one event.
13. **Omit, don't lament.** If a source is down or its data is too old to trust, leave that section or line out. Never write "email not connected", "data from yesterday", "still stale". If the outage needs the reader to act (reconnect an account), it's one Needs you item with the reconnect link, once; otherwise it goes to whoever maintains the brief, not into it.
14. **A real empty state is information.** If a source works and has nothing, "Nothing waiting" is a true statement in one line. That's different from a broken source, which is omitted.
15. **No filler.** No greeting paragraph, no motivational line, no "all clear", no subtitle restating the counts. If a line has no job the rest of the brief doesn't already do, delete it rather than rewording it.
16. **Respect what's private.** Email shows sender and subject, not bodies. Money shows amounts to the reader only. A brief posted to a shared channel gets the shared subset, never the personal one.

### Delivery

17. **Delivered copies keep the same shape.** A version posted to chat or email uses the same date heading, section headings and item format as the full brief, condensed, so every surface reads as one product.
18. **Confirm delivery before saying it's delivered.** Send in the foreground, read the response, report the observed result. A scheduled run that backgrounds its send can exit before the send completes while still logging success.

## Workflow

1. **Pick the mode.** Read the existing brief's date. Not today: build. Today: refresh.
2. **Gather in parallel.** For each source, fetch only the window that matters (since the last build for history; now for live sections), with full timestamps.
3. **Bucket times** with code in the reader's timezone.
4. **Filter.** For each candidate item: is it new, real and actionable, or needed context? Drop the rest. Move 24-hour-old Needs you items to Carried forward. Drop resolved carried items.
5. **Write** in the fixed shape and item format (`references/brief-template.md`).
6. **Check the plumbing stayed out.** Search the draft for "stale", "not connected", "unavailable", "all clear", "no data". Delete each.
7. **Deliver**, confirm the send, and report what went where.

## Before you call it done

- [ ] The brief's date is today's, at heading size, and every item under it is from today's run.
- [ ] Sections in the fixed order; empty ones omitted, true empty states stated once.
- [ ] Every item is `**Label**: sentence. [action](link)`, with its action present.
- [ ] Needs you has five or fewer items, all new; older ones moved to Carried forward.
- [ ] Every relative time came from a computed bucket in the reader's timezone.
- [ ] No outage, staleness or filler lines; no bare URLs on their own line.
- [ ] Under about 300 words.
- [ ] Delivery confirmed from the send's response.

## Never

- Yesterday's brief under today's date.
- "Email: not connected" or any sentence about the brief's own sources.
- The same unresolved alert at the top three days running.
- A subtitle like "1 run today · all clear".
- Checkboxes on bullets that can't be ticked.
- An approval with no approve button, an email with no link.
- "An hour ago" computed by hand.
- A bare link on its own line.
- A shape that changes from one day to the next.

## References

- `references/brief-template.md`: the document and chat templates, a filled example, the mode logic and the time-bucket function. Open at step 5.
- `references/glance-view.md`: rules for rendering the brief as an "at a glance" view in an app: date treatment, tabs and counts, item rows and their controls, failures, freshness and empty states. Open when the brief is a screen rather than a document.
