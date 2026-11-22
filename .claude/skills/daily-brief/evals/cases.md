# Evals: daily-brief

## 1. Morning build with a source down
Prompt: "Build my morning brief." (Fixtures: git history with commits at 02:10Z and 14:30Z the previous day, reader in New York; two unread important emails; the calendar source returns an auth error; an unresolved failure first flagged two days ago.)
Pass: heading is today's weekday and date; commits bucketed by computed time (the 02:10Z commit as yesterday evening or overnight in New York, not "this morning"); emails as one line each with links; no Today section and no sentence about the calendar outage beyond a single Reconnect item under Needs you; the two-day-old failure under Carried forward, not Needs you; every item in the bold-label format.
Fail: "Calendar: not connected"; times computed by hand and wrong; the old failure re-alarmed at the top; bullets without links.

## 2. Midday refresh
Prompt (at 14:00, with today's brief already built at 08:00): "Refresh the brief."
Pass: recognises refresh mode from the existing date; updates Needs you and Waiting only; leaves Since yesterday and Carried forward untouched; updates the "Updated" time; doesn't rebuild the whole brief.
Fail: rewrites the whole brief; duplicates items already in Needs you; leaves the morning's Waiting list in place.

## 3. Yesterday's content under today's date
Prompt: "It's 08:40 and my home page says today's date but the emails are from yesterday. Fix the glance."
Pass: identifies that the view shows a stale brief under the current date; makes the view build on open (or show the previous brief under its own date until the build runs); adds a quiet updated time; verifies by loading the view.
Fail: changes the heading date logic only; adds a "data may be stale" note.

## 4. Glance view restyle
Prompt: "The day-at-a-glance section on the home page is just a bulleted list with checkboxes. Make it actually useful."
Pass: puts the date at heading size; sections as tabs with counts in the label's own colour; rows with a bold label, one line of detail and an always-visible action (approve and deny inline for approvals, a start control for to-dos, links for email); removes checkboxes and any filler subtitle; consistent label weight across tabs; checks 375px.
Fail: wraps each bullet in a card and keeps the checkboxes; accent-coloured counts; hover-only buttons; adds a subtitle like "3 items need you".

## 5. Posting to chat
Prompt: "Post today's brief to my channel."
Pass: posts a condensed version with the same date heading and section headings as the full brief, links inline, no bare URLs on their own lines, only the shareable subset; sends in the foreground and reports the response.
Fail: a different shape from the document; bare links that unfurl; says it's posted before the send returns.
