---
name: social-listening
description: >-
  Keeps a running, cited pulse on a landscape (a market, a technology, a category, a community)
  by read-only monitoring of forums, social platforms, changelogs and launch sites. Covers the
  watchlist, separating signal from noise, clustering into themes, a one-line-per-finding digest,
  and a living landscape page whose confidence compounds as signals recur, with carried items
  marked and stale ones expired. Use when asked for a pulse, a sweep, a digest, "what are people
  saying about X", "what's trending in X", the sentiment on a launch or competitor, or when
  running a scheduled listening digest. For one factual question, do focused research instead. Do
  not post, reply, like or follow on any platform, report sentiment without links to the posts,
  or re-post an unchanged digest as new, without loading this skill first.
license: MIT
metadata:
  author: Baseline Studio
  version: 1.0.0
  group: Agents
  pairs-with: [daily-brief]
---

# Social listening

Know, at any moment, what is actually happening and being said in a landscape, and surface the signal (a real shift, a launch that matters, a complaint that keeps coming back, a practice taking hold) out of the noise. Then make that knowledge compound, so the read gets sharper each week instead of longer.

## The bar

A reviewer accepts a pulse when:

- Every finding links to the posts or threads it's built on.
- It reads in under a minute: a few category headings, one bold-label line per finding.
- Each finding says why it's worth knowing, plainly.
- Recurring signals are marked as recurring; items carried from earlier sweeps are marked as carried.
- Practitioners doing the work are the primary sources; press coverage supports a theme at most.
- The living landscape page got sharper: confidence moved, stale lines dropped.

A reviewer sends it back when it reports engagement counts as insight, invents or inflates sentiment, writes a paragraph per theme, leads with trend pieces, or ships the same block as yesterday with nothing marked.

## Rules

### Scope

1. **Declare what you're listening for.** State the landscape and the lens at the top of the watchlist: market intelligence (what people do, need and adopt) or brand monitoring (what people say about one product). They're different jobs with different sources; default to market intelligence unless asked, and don't drift into the other.
2. **Read-only, always.** Never post, reply, like, follow, DM or vote on any platform, even when a reply looks helpful. Drafting anything public goes to the person who owns that voice.
3. **No invented sentiment.** Report what the discourse says, with links. If you can't point to the posts, you don't have the finding. Mixed is a valid answer; say mixed.

### Sources

4. **Keep a watchlist and read it at the start of every run.** Topics and keywords, communities, searches, accounts and named competitors (`references/watchlist.md`). It is a starting point the owner tunes. End each run with suggested additions and removals.
5. **Search by keyword every run; timelines are a supplement.** A handful of followed accounts plus a generic trending feed misses most of a niche. Generic trending feeds carry almost no niche signal; use them only when nothing else surfaced anything.
6. **Weight sources by what they're good for.** Technical forums for launches and the sharpest teardowns (the comment thread is often the real signal); community forums for "does this actually work", comparisons and complaints; fast social platforms for first reactions, weighted as the noisiest; changelogs and release pages for what really shipped.
7. **Practitioners over press.** A named person showing their real setup, their real complaint, beats a mainstream piece repeating one survey stat. Name the person, account or repository whenever the source allows; if a source is anonymous, say so rather than inventing a name.
8. **An empty fetch isn't proof of silence.** If a batch fetch returns nothing for a community that's usually active, retry it individually before writing "no posts". If it's confirmed empty, say so once and stop re-flagging it.

### Method

9. **Sweep the window.** Default to the last 24 hours for a daily pulse and 7 days for a weekly one. Pull posts with real traction or real substance, not everything that matched a keyword.
10. **Separate signal from noise.** Signal: a launch, a capability shift, a strong or surprising reaction, a complaint that recurs, a comparison people keep making, a term suddenly everywhere. Noise: routine chatter, reposts, engagement bait, one-off hot takes with no uptake. A keyword count is not a finding.
11. **Cluster into three to six themes, not thirty bullets.** For each, say what's being said, its direction (rising, contested, cooling), and why it's worth knowing, the way you'd tell a colleague over coffee.
12. **A need counts only once it recurs.** An unmet need or pain point gets a line only after it has shown up at least twice (this sweep or earlier ones). A single ask is a candidate for next time.
13. **Tag the evidence basis of effect claims.** When a post says a technique worked ("halved latency", "measurably better"), say what that rests on: the author's framing, one run, no comparison, a hand-picked task. Otherwise the claim gets inherited downstream as a result to replicate instead of an idea to test.
14. **Separate what they said from what you think it means.** Interpretation is welcome; label it.

### Making it compound

15. **Reconcile every digest into the landscape page.** One living page per landscape is the single source of truth. For each finding, do one of: **new** (add it as *watch*, a single data point); **recurring** (raise its confidence: *watch*, then *signal* when seen repeatedly, then *established*); **changed** (overwrite the stale line and add a dated line to the page's shifts log); **stale** (demote or drop). Never append blindly; the page must get sharper, not longer.
16. **Screen for action in two lanes.** *Gaps*: a recurring need (2+ times) that bears on something the owner builds or could build; name which product, or say "candidate for something new". *Inspiration*: a well-executed build or technique with real traction; no recurrence needed, but name the transferable mechanism, not just that it got attention. These are candidates for the owner to route, not approvals to build.
17. **Mark carried items.** Any action candidate that appeared in an earlier digest gets `(carried, sweep N/3)`; new items get no marker. If a section has nothing new, open it with one line ("Carried from earlier sweeps: 3 items, nothing new today") and still list them. An unmarked repeated block turns into wallpaper the reader stops seeing.
18. **Expire after three unrouted sweeps.** An action candidate shown three times without anyone picking it up is removed. If it resurfaces later with new sources, it re-enters at sweep 1.
19. **Remove routed items the same run.** The moment a candidate is picked up, dismissed or folded into a project, replace it with a one-line "Routed <date>, to <where>". Detect routing from a record the run can actually read (a project file, a tracker), not from a conversation it can't access.
20. **Verify every name in a routing line.** If a candidate says "route to the onboarding skill" or "fits the export feature", confirm that thing exists before writing it. If it doesn't, the absence is often the real finding.
21. **Sharpen weekly.** Once a week, re-read the landscape page, prune watches that never recurred, harden what's established, and rewrite its implications section as a short state of play.

## Modes

- **Pulse**: a scheduled or requested sweep of the whole watchlist over the window. Produces the digest, reconciles the landscape page, and posts if the schedule says so.
- **Ask**: "what are people saying about X". A focused sweep of one topic across all sources, same output shape, scoped to the question. Doesn't post and doesn't commit.

## Output

One bold-label line per finding, grouped under a few headings, links inline. The full template, with the landscape page and the action section, is in `references/digest-format.md`.

```markdown
# <Weekday, D Month>: <landscape> pulse

## What practitioners are doing
- **<Who>**: <what they're doing and why it's worth knowing>. [Source](link)

## Tools and comparisons
- **<Label>**: <one sentence>. [Source](link)

## Recurring needs
- **<Label>**: <the need; where else it showed up>. [Source](link), [Source](link)

## On the radar
- <one line, bubbling up, not yet a full finding>

## Action candidates
### Gaps
- **<what>**: <finding> → <product or "candidate for something new">, <why now>. [Source](link) (carried, sweep 2/3)
### Inspiration
- **<what>**: <finding and the transferable mechanism> → <where it could go>, <why now>. [Source](link)
```

Omit any heading with nothing real, except Action candidates, which always appears (with "Nothing currently active" when empty) so a skipped check never looks like a quiet day.

## Workflow

1. **Read the watchlist** and the landscape page's current state.
2. **Sweep** each source by keyword over the window; then timelines; confirm suspicious empties.
3. **Filter** to signal.
4. **Cluster** into three to six themes; check each need for recurrence.
5. **Reconcile** into the landscape page: new, recurring, changed, stale.
6. **Screen action candidates** in both lanes; check routing; mark carried items; expire and remove routed ones; verify names in routing lines.
7. **Write the digest**, copying the landscape page's current action section into it.
8. **Deliver** (scheduled pulse only), confirming the post from its response.
9. **Suggest watchlist changes**: new names that recurred, sources that were consistently empty.

## Before you call it done

- [ ] Every finding has an inline link to its source posts.
- [ ] Three to six themes; one line per finding; under a minute to read.
- [ ] Each recurring need has appeared at least twice, with both sources cited.
- [ ] Effect claims tagged with their evidence basis; interpretation labelled.
- [ ] Named practitioners lead; press supports at most.
- [ ] Landscape page reconciled; confidence levels moved; shifts log updated where lines changed.
- [ ] Carried items marked with their sweep count; expired and routed items removed.
- [ ] Every product, feature or skill named in a routing line confirmed to exist.
- [ ] Nothing posted, liked or replied to on any monitored platform.

## Never

- "2.3k likes!" as the finding.
- A sentiment claim with no posts behind it.
- A paragraph per theme.
- Yesterday's action block re-posted unmarked.
- A trend piece from the mainstream press as the lead item.
- "A Redditor said" when the username was right there.
- "No posts in that community" from one empty batch fetch.
- A routing line pointing at a tool or feature that doesn't exist.
- Any write action on a monitored platform.
- A new one-off page for a routine pulse item when the landscape page exists.

## References

- `references/watchlist.md`: how to build and tune a watchlist (topics, communities, searches, accounts, competitors), with a filled example. Open at step 1, and at step 9 to propose changes.
- `references/digest-format.md`: the full digest template, the landscape page template with confidence levels and shifts log, the action-candidate line format with sweep markers, and the expiry and routing rules in one place. Open at steps 5 to 7.
