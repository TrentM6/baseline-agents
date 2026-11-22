Contents: rules for rendering the daily brief as an "at a glance" view in an app: heading and date, sections as tabs, counts, item rows and their controls, approvals and to-dos, failures, freshness, empty states and phone layout.

# The glance view

When the brief lives on a home screen rather than in a document, it is usually the most important thing on that screen: where people get caught up, see what's waiting and approve things. Treat it as the product's front door, not a widget.

## Heading and date

- The heading names the view and the day together: "Your day, Monday 23 November", or a greeting by time of day and name above the date ("Good morning, Sam" then "Monday, 23 November"). The date is set at heading size, never as a grey afterthought: it orients the reader to which day they're looking at.
- Show the date once. If the glance carries it, the page header doesn't repeat it, and the page doesn't get a subtitle restating counts or status. A subtitle like "1 agent run today · all clear" says nothing and should be deleted, not rewritten.
- A quiet "Updated 11:45" beside the date is the one status line that earns its place.

## Sections as tabs

- Once there are more than three sections, or any section can grow long (inboxes, approvals), make each section a tab: Needs you, Waiting, Today, Since yesterday. One long page of every source becomes hard to scan at the volume a team generates.
- A count beside a tab label ("Waiting 4") uses exactly the label's colour and weight: the inactive grey when inactive, the active colour when active. Never an accent colour, never darker or bolder than the label.
- Hide the count when it's zero rather than showing "0".

## Item rows

- Items are rows in a grouped list: one row per item, a hairline between groups, not between every row. Don't wrap each item in its own bordered card, and don't put checkboxes beside bullets that can't be ticked.
- Every row has the same anatomy in every tab: a bold label, one line of detail, and its action on the right. If labels are bold in one tab and plain in another, fix every tab in the same pass.
- The action is always visible, not revealed on hover. People scan for the button; a hover-only control is invisible on touch screens and slows everyone else.
- Primary actions use the product's one accent; secondary actions are outline buttons, not bare text links that look like labels.

## Approvals and to-dos

- An approval row carries approve and deny inline. Opening a separate page to approve one thing is a round trip the glance exists to remove.
- A to-do row carries a way to start it: a link to where it's done, or a control that opens a working session with the to-do already loaded.
- Messages and email link straight to the thread. Files, pages and builds link to the thing itself.

## Failures

- A failure that needs the reader appears inside the glance as one Needs you row: what failed, in plain words, and the action (fix it, hand it to someone or something that can, view the run). Not a full-width alert above the page.
- The row must lead somewhere useful. A "view details" link that opens an admin screen with no trace of what happened is a dead end; link to the run's own log or the fix.

## Freshness and updates

- The glance must never show yesterday's items under today's date. If today's build hasn't run, build on open, or show the previous brief under its own date until it does.
- Live sections update through the day, on a schedule or on open, so a reader who opens it at 3pm sees 3pm's state.

## Empty states

- A tab whose source works and has nothing says so in one line in the list's own type ("Nothing waiting").
- A tab whose source is down is hidden, not filled with an error. If the reader must reconnect something, that is a Needs you row with the reconnect control.

## Phone

- Tabs scroll horizontally if they don't fit; they never wrap to a second line.
- Item rows stack the action under the detail when the row is narrower than about 360px; controls stay at least 44px tall.
- Check it at 375px wide with the longest real subject line in each tab.
