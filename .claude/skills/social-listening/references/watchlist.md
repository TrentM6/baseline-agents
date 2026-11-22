Contents: what a watchlist holds, how to choose each part, how to tune it from run to run, and a filled example for a design-tools landscape.

# Watchlist

The watchlist is the list of what a sweep covers. It's a starting point the owner tunes, not a fixed script. Keep it in one file beside the landscape page.

## What it holds

1. **Scope line.** The landscape, the lens (market intelligence or brand monitoring) and the audience the findings serve. One or two sentences.
2. **Topics and keywords.** Core terms swept every run, and watch-when-mentioned terms. Include the words practitioners use, not only the official names: product nicknames, abbreviations, the verbs people use for the work.
3. **Communities.** The forums and subcommunities where practitioners talk shop, split into high-signal (where people show real work) and broad (where adoption and backlash show up).
4. **Searches.** The exact queries run on each platform, with the platform's own operators (recency sort, exact phrase, excluded terms).
5. **Accounts.** People and organisations who reliably post first-hand work or the first independent read on a launch. A supplement to search, never the backbone.
6. **Competitors and named watches.** Anyone whose launch, pricing change or positioning move is always a theme.
7. **Excluded noise.** Terms and sources that consistently produce nothing, so the sweep stops spending calls on them.

## Choosing well

- **Start from questions, not platforms.** What does the owner need to know? What would change a decision? Each core keyword should map to one of those.
- **Favour places where people show their work.** A thread of people posting their real setups beats a feed of announcements.
- **Include the broad crowd deliberately.** Practitioner forums tell you what experts do; general communities tell you what's reaching everyone else. Both are signal; label which is which.
- **Name accounts by what they're good for.** "First independent benchmark on launches" is a reason to follow; "popular" isn't.

## Tuning

At the end of every run, propose:

- **Add**: a person or project named in two or more threads who isn't on the list; a term that showed up across sources this week; a community where a recurring need kept appearing.
- **Remove**: a search or community that returned nothing useful for four consecutive runs (after confirming the emptiness with an individual fetch, not a batch).
- **Fix**: a search that keeps returning off-topic results; narrow it with exact phrases or excluded terms.

Date every change, so a shift in the digest can be traced to a shift in the list.

## Filled example

```markdown
# Watchlist: product design tools

Scope: market intelligence on how product designers and design engineers work, which
tools they adopt and drop, and what they keep asking for. Not brand monitoring.

## Core topics (every run)
- design systems, design tokens, component libraries
- design-to-code, handoff, "dev mode"
- prototyping tools, interactive prototypes
- AI in design work: generation, critique, agents that edit files

## Watch when mentioned
- design ops, design QA, visual regression testing
- accessibility tooling for designers

## Communities
High signal: design-systems forums and channels, front-end and design-engineering forums
Broad: general design communities, product management communities

## Searches
- "design tokens" sorted by latest, last 24h
- "design system" (migration OR rebuild OR deprecated), last 7d
- "handoff" (designer OR developer) complaint phrasing: "hate", "broken", "wish"

## Accounts
- Maintainers of the three most-used open-source component libraries (first word on breaking changes)
- Two independent reviewers who benchmark new tools within a week of launch

## Competitors and named watches
- Any launch, pricing change or positioning move from the four leading design tools

## Excluded noise
- Generic "trending" feeds (no niche signal in 30 runs, removed 2026-10-02)
```
