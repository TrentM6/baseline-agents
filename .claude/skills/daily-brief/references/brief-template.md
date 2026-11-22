Contents: the mode decision, the time-bucket function, the full brief template, a filled example, the condensed chat version, and a list of lines to delete on sight.

# Brief template

## Mode

```
read the existing brief's heading date
if missing or not today (reader's timezone):  BUILD   (write the whole brief fresh)
else:                                          REFRESH (rewrite Needs you and Waiting only)
```

The mode is inferred from the file, never passed in, so a scheduler can fire the same command all day without clobbering a good brief or refreshing one that doesn't exist.

## Time buckets

Bucket every timestamp with code, in the reader's timezone:

```js
function bucket(isoWithOffset, now = new Date(), tz = "America/New_York") {
  const fmt = (d, o) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, ...o }).format(d);
  const t = new Date(isoWithOffset);
  const day = d => fmt(d, { year: "numeric", month: "2-digit", day: "2-digit" });
  const hour = Number(fmt(t, { hour: "2-digit", hourCycle: "h23" }));
  const today = day(now);
  const yest = day(new Date(now.getTime() - 864e5));
  if (day(t) === today && hour < 5) return "overnight";
  if (day(t) === yest && hour >= 21) return "overnight";
  if (day(t) === today && hour < 12) return "this morning";
  if (day(t) === today) return "today";
  if (day(t) === yest) return "yesterday";
  const days = Math.round((new Date(today) - new Date(day(t))) / 864e5);
  return `${days} days ago`;
}
```

Use the reader's own timezone, not the server's. Fetch source timestamps with their offsets (for git, `%cI`, never a format that drops the time).

## Template

```markdown
# <Weekday>, <D Month>
Updated <HH:MM>

## Needs you
- **<Short title>**: <why it needs the reader, one sentence>. [<action>](link)

## Since yesterday
- **This morning**: <what landed, with exact times and links inline>
- **Overnight**: <what landed 21:00 to 05:00>
- **Yesterday**: <daytime work>

## Waiting
- **Email**: <n> need replies: [<subject>](link) from <sender>, [<subject>](link) from <sender>
- **Reviews**: [<title> #<n>](link) open 3 days, blocks <thing>

## Today
- **<time>**: <meeting or deadline>. [Open](link)

## Carried forward
- <short description>. [<action>](link)
```

## Filled example

```markdown
# Monday, 23 November
Updated 08:02

## Needs you
- **Approve the payroll run**: due by 11:00 for Friday's payday. [Review](link)
- **Reconnect calendar**: the calendar account signed out overnight, so today's meetings are missing below. [Reconnect](link)

## Since yesterday
- **Overnight**: the 02:15 import loaded 1,284 orders. [Log](link)
- **Yesterday**: shipped the onboarding fix ([#212](link)) and the pricing page copy ([#214](link)).

## Waiting
- **Email**: 2 need replies: [Contract redlines](link) from the agency, [Venue hold expires Wednesday](link) from the venue.
- **Reviews**: [Search filters #218](link), open 3 days, blocks the beta release.

## Carried forward
- Renew the domain before 30 November. [Registrar](link)
```

Note what isn't there: no greeting paragraph, no "all clear", no line about the calendar outage beyond the one action that fixes it, no Today section because its source is down.

## Chat version

Same heading levels, condensed to one line per section, links inline:

```markdown
# Monday, 23 November

## Needs you
- **Approve the payroll run**: due 11:00. [Review](link)

## Waiting
- **Email**: 2 need replies. **Reviews**: #218 blocks the beta.

Full brief: [today](link)
```

## Delete on sight

Lines that describe the brief instead of the day:

- "Email not connected", "gateway unreachable", "source unavailable"
- "Data from yesterday", "still stale", "N days stale", "reconfirmed again"
- "All clear", "Nothing needs you", "Your agents are standing by"
- "1 run today · all clear" or any subtitle restating counts shown below
- "Here's your brief for today!" and other openers
