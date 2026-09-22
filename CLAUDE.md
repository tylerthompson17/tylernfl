# Tyler NFL

Personal NFL analytics site: public tools (4th down model first), stat leaders, a daily "on this day" feature, and occasional articles. Hosted on GitHub Pages at `https://tylerthompson17.github.io/tylernfl`.

## Division of labor

- Claude Code owns: site scaffolding, layout, components, styling, data plumbing, GitHub Actions.
- Tyler owns: all statistical modeling (win probability, 4th down logic, team ratings). Do not write model logic. Leave clearly marked stubs and interfaces instead.
- Tyler owns `pipelines/charts/mine/`, like the modeling code: his chart scripts. Do not
  write, edit or delete anything in that folder. Claude Code wrote its README and
  `example_template.py` once, when the folder was created, and does not touch them
  again. Build what those scripts import (`pipelines/charts/style.py`) and the pages
  that show their charts, and change `style.py` without breaking what it offers.
- Round number thresholds the sport already treats as milestones (300 passing
  yards, a 100 yard game) are not modelling; they are the site's editorial
  choice, like the leaderboard qualifiers. Scoring one kind of game against
  another is modelling and is Tyler's.

## Stack

- **Astro** (static output), TypeScript, plain CSS with custom properties. No Tailwind, no UI kit.
- Interactive pieces are Astro islands. Use plain TS or Preact only where interactivity is needed.
- Fonts self-hosted via `@fontsource` (no external font requests).
- Python pipelines live in `pipelines/` and are not part of the Astro build.

## Repo layout

```
tylernfl/
├── CLAUDE.md
├── astro.config.mjs        site + base path config
├── src/
│   ├── styles/tokens.css   all design tokens (single source of truth)
│   ├── styles/global.css
│   ├── layouts/            BaseLayout (ticker, header, 3-column shell)
│   ├── components/         Panel, StatTable, StatCard, TickerItem, TeamChip, ...
│   ├── pages/              index, scores, charts/, curated, tools/, stats/, articles/, about, 404
│   ├── content/articles/   MDX articles (content collection)
│   ├── content/charts/     Tyler's charts: <slug>.md entry next to <slug>.svg
│   ├── content/curated/    curated X and Bluesky posts, one .md each, added by hand
│   └── data/               JSON consumed at build time (mock now, pipeline output later)
├── public/logos/           team logos for charts (pipelines/build_logos.py)
├── pipelines/              Python jobs: run_daily.py (ticker, boards, standings), run_weekly.py, build_teams.py
│   └── charts/             style.py (shared chart style), auto.py (auto chart), build.py
│       └── mine/           Tyler's chart scripts (his; do not edit)
├── models/                 exported model files (empty for now)
└── .github/workflows/      deploy.yml, daily.yml (weekly.yml later)
```

## GitHub Pages rules

- `astro.config.mjs`: `site: 'https://tylerthompson17.github.io'`, `base: '/tylernfl'`.
- Every internal link and asset path must respect the base path (use `import.meta.env.BASE_URL` or a small `url()` helper). Hardcoded `/stats` style links will break in production.
- Deploy with the official `withastro/action` on push to `main`.
- CSS is inlined into every page (`build.inlineStylesheets: 'always'`, about 3 KB gzipped
  per page). GitHub Pages lets browsers and its CDN keep a page for 10 minutes
  (`max-age=600`) and each deploy replaces the whole site, so a page cached before a
  deploy used to ask for the previous build's stylesheet, get a 404, and load unstyled.
  Keep it inlined. Scripts are still separate files: a page cached across a deploy can load
  without its ticker, carousel and search until reloaded (it still looks right).

## Data contract

- Pipelines write JSON into `src/data/`, commit it, and the push triggers a rebuild. Pages read data at build time.
- Browser-side fetches are allowed in exactly two places. Nothing else fetches data at runtime.
  1. **Live scores** (`src/lib/live-ticker/`). During game windows (15 minutes before each unfinished game's kickoff to 4.5 hours after), the browser polls ESPN's public scoreboard (`site.api.espn.com`) every 30 seconds while the tab is visible and updates scores in place. One poll feeds every game on the page: the ticker slots and, on `/scores`, the boxes, which carry the same `data-game` hooks. After a game's window closes, ticker.json still shows it unfinished until the next daily run (a Monday night game ends near midnight; the run is at 6 AM and has started hours late), so a page loaded with a game that kicked off within the last 48 hours, past its window and not final in ticker.json, makes one scoreboard request on load to pick up the result (up to 3 tries on failure; `needsCatchUp` in `schedule.ts`). One request, never polling. It matches games by `espnId`, never moves a game backwards (final stays final), backs off on errors, and leaves the `ticker.json` data showing on any failure. Live games also show who scored last: when a live game's score changes, the browser fetches that one game's summary (`/summary?event=`) once, retrying up to 3 times over about a minute if it trails the scoreboard. It is never polled on a timer (it is about 175 KB, of which the scoring plays are about 1 KB), and it is one fetch per scoring play however many places render the line. Turn it all off with `LIVE_TICKER_ENABLED` in `src/config.ts`. Requests must stay plain GETs with no custom headers (ESPN rejects CORS preflight). The API is unofficial and can change or disappear without notice.
  2. **Live 4th down page** (later): fetches game state at runtime.
- Header search is not a runtime data fetch: its index (`search-index.js`, from
  `src/pages/search-index.js.ts`) is static build output, versioned per build, and the
  search box loads it as a script the first time it is used (about 50 KB gzipped). It
  covers every player page, every team and the site's pages; matching and ranking live
  in `src/lib/search/match.ts`. Nothing else may use this as a way to load data.
- ESPN data is browser-only: never write it to `src/data/` and never use it in pipelines. Pipelines use nflverse (the `espnId` in `ticker.json` comes from nflverse schedules). Test fixtures in `tests/fixtures/espn/` are the only stored ESPN data.
- Upcoming kickoff times display in the visitor's time zone, formatted in the browser from the UTC `kickoff` field (not from ESPN's text). That covers the ticker's upcoming slots, the `/scores` kickoff headings, and dates on team pages.
- In-progress parsing (quarter, clock, halftime, final) is verified against the real capture from DET at BUF on
  2026-09-17 (`tests/fixtures/espn/`). Not yet seen in a real response: an end of quarter status (ESPN showed the
  next quarter at 15:00 instead) and live overtime. Add a capture when one happens.
- Mock JSON files must match the real schemas exactly, so pipelines can overwrite them without touching site code. Define a TypeScript type for each file in `src/data/types.ts`.
- Files: `ticker.json`, `stats/{board}.json`, `players/{TEAM}.json`, `rosters/{TEAM}.json`,
  `transactions.json`, `team_stats.json`, `player_epa.json`, `on_this_day.json`, `standings.json`, `schedule.json`, `playoff_odds.json`, `teams.json`, and the auto chart in `charts/`.
- `teams.json` (abbr, name, conference, division, primary/secondary colors) should be generated from nflverse team data, not typed from memory. If that is not possible yet, leave colors as neutral placeholders and flag it.
- `ticker.json`, `stats/`, `players/`, `rosters/`, `transactions.json` and `on_this_day.json` are real data written by
  `pipelines/run_daily.py` (nflreadpy), run by `.github/workflows/daily.yml` every morning
  at 6 AM Eastern and again Friday at 8 PM Eastern, after teams file Sunday game statuses.
  nflverse calls the Rams `LA`; pipelines normalize it to `LAR`.
- `stats/{board}.json` holds the full player leaderboards (passing, rushing, receiving,
  defense, kicking). The pipeline decides values, ranks and who qualifies; the site only
  sorts and switches totals / per game in the browser. Qualifying bars are per team game
  and are this site's choice, set in `pipelines/leaderboards.py`.
- `players/{TEAM}.json` holds game logs for the players currently on each team, one row per
  game per leaderboard, computed by the same `board_values` as `stats/`, so a log sums exactly
  to the leaderboard row. Season totals and ranks are not repeated there; player pages read
  them from `stats/{board}.json` by player id. Written compactly (one line) because a full
  season is about 1 MB; every other data file stays indented.
- `transactions.json` holds roster moves derived from weekly nflverse roster snapshots
  (`load_rosters_weekly`) and the injury report (`load_injuries`) for the ticker's week;
  empty in the offseason. Each player is compared with the last snapshot he appeared in,
  and only an explicit status row counts as leaving: a missing row means nothing (byes
  have no snapshot, and in 2025, 97% of vanished players came back on the same team).
  Game-day inactives and active roster / practice squad moves are not moves.
- Each move and injury entry carries a category (for the wire's type filter), a snap share
  (last 8 games of offense or defense snaps, this season and last, from `load_snap_counts`
  mapped to gsis ids through `load_players`), a starter flag (50% or more) and a priority:
  news (game statuses, real moves) before routine items (practice squad, practice reports),
  starters first within each. The home page shows the top of the news; `/transactions` is
  the full wire, filterable by team, type and starters, with the filter kept in the URL
  (`?team=BUF&type=reserve&starters=1`).
- Rosters are one file per team so an unchanged team is not rewritten. Player URL
  slugs are written by the pipeline, not derived by the site, because players who
  share a name need a team suffix. `player_slug` in `pipelines/common.py` and
  `playerSlug` in `src/utils/slug.ts` must produce the same strings.
- `team_stats.json` is written by `pipelines/run_weekly.py`, run Wednesday mornings by
  `.github/workflows/weekly.yml`, from nflverse play-by-play. Definitions live in the
  `pipelines/team_stats.py` docstring. Values are rounded to the displayed precision
  before ranking, so equal displayed values share a rank.
- `player_epa.json` is written weekly by `pipelines/player_epa.py`, next to
  `team_stats.json` and from the same play-by-play: EPA per dropback (nflfastR's `qb_epa`
  over passes, sacks and scrambles, by the `id` player) and rush EPA per carry (`epa` on
  designed runs). Every qualified player, ranked on the value rounded to 3 places;
  qualifiers match the boards (14 dropbacks, 6 carries per team game). Names and current
  teams come from the passing and rushing boards by gsis id. Definitions are in its
  docstring.
- A week counts in the weekly files only once every game in it is final in the schedule
  and present in the play-by-play (`last_complete_week` in `team_stats.py`): nflverse adds
  a Monday night game to play-by-play overnight, after the schedule shows it final.
- There is no `leaders.json` any more. Every top 5 on the site (the stats overview, the
  home page's receiving panel, a team's stat leader appearances) comes from the boards and
  `player_epa.json` through `src/utils/overview.ts`, whose rows carry player ids.
- Play-by-play goes through `pipelines/pbp_cache.py`: completed seasons are cached for
  good, the current season refreshes after 12 hours. CI persists the cache with
  `actions/cache`. Anything that needs pbp (including the 4th down model) should load
  it through this module rather than calling `nflreadpy.load_pbp` directly.
- `on_this_day.json` is real data written daily by `pipelines/on_this_day.py`: up to 3 notable games
  played on today's date (one per season, newest first), picked and worded only from nflverse schedule
  fields (score, round, overtime, closing spread, temperature). It covers games since 1999 and nothing
  else, so no hand-written history. Washington is named by city in every season, and relocated teams
  link to today's franchise page.
- The auto chart is drawn by
  `pipelines/charts/auto.py` at the end of `run_daily.py` from the files it just wrote
  and `team_stats.json`. The morning after a game day it is win probability of that
  day's closest game (smallest margin, ties to the later kickoff; from play-by-play
  through `pbp_cache.py`, skipped if nflverse has not published the game yet). Other
  days the date picks between offense vs defense EPA and a top 5 yards race (from
  week 4), so a rerun gives the same chart. The WP chart marks no plays on the line (key
  play callouts were tried and removed); the hover readout names each play. Win
  probability and EPA are nflfastR's
  published values, not a model of this site's, and the chart's source line says so;
  when Tyler's win probability model exists, the WP template should use it.
- Every auto chart is kept: `charts/archive/<slug>.{json,svg,hover.json}`, one set per
  chart, and `charts/auto.json` names today's (`{"slug": ...}`). The slug says what the
  chart covers (`auto-2026-week-2-ind-at-kc-win-probability`,
  `auto-2026-week-2-offense-defense-epa`, `auto-2026-week-5-rushing-yards-race`), so a
  rerun, or another day drawing the same week's EPA or race, redraws that entry rather
  than adding a near copy; a redrawn entry keeps the date it was first drawn (a WP
  chart's date is its game's). The home page shows today's only when none of Tyler's
  charts is featured, labeled "Auto chart". The 2026 WP charts before this was added
  were backfilled by hand; nothing earlier was kept.
- Team logos in `public/logos/<ABBR>.png` come from nflverse team data
  (`team_logo_squared`, hosted by nflverse), fetched by `pipelines/build_logos.py`, run
  by hand after a rebrand. Never ESPN's column. nflverse's Wikipedia links were stale
  when this was set up (dead thumbnail widths, and KC and LAR renamed). Charts do not
  embed logos: `style.py` writes `href="logo:BUF"` and the site resolves it under the
  base path (`resolveLogos` in `src/lib/charts/collection.ts`).
- `standings.json` is written daily by `pipelines/standings.py` from completed regular
  season games: records, division and conference ranks, and for each team the tiebreak
  step that placed it. Before a season's first game it holds last season's final
  standings. The tiebreakers are a literal port of nflseedR's `nfl_standings` (2.0.2) at
  its default depth (through strength of schedule, then coin toss), including its
  grouping and which teams each step re-ranks. Where nflseedR draws a coin toss at
  random, the port orders by abbreviation and records `coin_toss`.
- The port is checked against nflseedR itself: `tests/fixtures/standings/generate.R`
  (run by hand in R, never on the site or in CI) saves nflseedR's standings after every
  week from 4 to 18 of 2022 to 2024, and `pipelines/test_standings.py` must match every
  record, division rank, conference rank and tiebreak step, skipping only coin tosses.
  nflseedR cannot resolve two of those weeks (2022 week 13, 2023 week 8: it stops with
  "infinite loop"); the port falls back to a coin toss there. Change the tiebreakers
  only with the fixtures still passing.
- `schedule.json` is written daily by `pipelines/schedule.py`: every game of the ticker's
  season (regular season and playoffs) with kickoff, scores, overtime, divisional and
  neutral flags, and nflverse's lines as published (`spreadLine` is points the home team
  is favored by, negative when the road team is; moneylines are American odds). Lines
  appear about a week before a game and stay as they closed. Team pages and playoff odds
  read it.
- `playoff_odds.json` is written daily by `pipelines/playoff_odds.py`: 10,000 simulations
  of the rest of the regular season, each seeded with the standings' tiebreakers (the
  same `standings.compute`), about 10 seconds. Per team: chance of the playoffs, the
  division, the top seed, each seed 1 to 7, and average wins. Random draws are seeded
  from a hash of the inputs, so unchanged inputs write an identical file. Empty before a
  season's first game. Simulated games never tie.
- Game probabilities are a pluggable input: `GAME_PROBABILITIES` in `playoff_odds.py`, a
  function from unplayed games to each one's home win chance. The default reads
  nflverse's moneylines, margin removed by scaling the two implied probabilities to sum
  to 1; a game with no line is even odds. Lines exist only about a week ahead, so most
  games are even odds, and every place the odds show says "based on betting lines". No
  team rating model: Tyler's replaces the default, returning the same thing.
- `pipelines/test_playoff_odds.py` checks the simulator against a known season: 2024
  from week 12, every remaining game given its real result for certain, must give every
  chance as exactly 0 or 1 and reproduce the real final seeding and wins.
- There is no placeholder data left. The 4th down model record panel and
  `model_record.json` were removed until the model exists; restore them from git history
  (commit "Replace the rail's model record placeholder") when it does.
- The home page's notable performances panel is derived at build time from the
  `players/{TEAM}.json` game logs, not from a data file of its own. The week it
  shows is the latest one any game is logged for, which is not the ticker's
  week: from Wednesday the ticker looks ahead to games not played yet.
  `src/lib/performances/notable.ts` holds the rule and the bars, kept apart
  from the panel that renders it. Today the rule is one row per category: the
  week's leader in each board's headline stat, if it clears the bar. The
  intended replacement is a single list ranked across categories, which needs
  a way to score a passing day against a pass rushing day; that is Tyler's to
  write, and it should return the same `Performance[]` so the panel does not
  change.

## Design direction

Reference feel: Pro Football Reference's visual style (not its layout or
content). Utilitarian, dense, light. Structure comes from colored panel
header bars and boxed content, not decoration. Do not use PFR's green.

### Tokens

| Token | Value | Use |
|---|---|---|
| `--bg` | `#E9EBEE` | page background |
| `--panel` | `#FFFFFF` | panel body |
| `--header` | `#1F2E3D` | panel header bars (stadium slate) |
| `--header-text` | `#FFFFFF` | header bar titles |
| `--rule` | `#C3C9D0` | panel borders, table borders |
| `--rule-soft` | `#D9DDE2` | inner dotted dividers |
| `--text` | `#1A1D21` | body text |
| `--text-dim` | `#5B6570` | secondary text |
| `--link` | `#1A56B5` | all links, underlined |
| `--highlight` | `#F2D22E` | first-down yellow, background only |
| `--win` | `#1E7A4C` | positive values |
| `--loss` | `#B3363B` | negative values |

- Radius 0, no shadows, no gradients.
- No motion, with two exceptions, both in the score ticker:
  - A ticker group is a looping carousel, a slow continuous glide. It pauses
    on hover and keyboard focus, and stays a static, swipeable strip on touch
    devices, for reduced motion, and when its games fit. A 12px gap and a thin
    rule after the week label mark where games glide out of view, so they never
    disappear under the label itself. (A version that stepped one game at a
    time was tried and dropped: the start-stop slide read worse.)
  - When a live score changes, the new number gets a brief yellow background
    that fades out (2s). Off under reduced motion.
- The ticker row is the week label, then two groups of games: live games,
  then the strip of finished and upcoming ones. Live games take the width
  they need, up to the whole row; the strip gets the remainder and is
  dropped once that is under one game slot (160px, `showsStrip` in
  `src/lib/live-ticker/pin.ts`). So a full Sunday slate makes the ticker
  only the games in progress, and the strip returns as games end. An empty
  group is hidden, which is how the page is built: no game is live at build
  time, so the strip starts with the whole row. Either group loops as a
  carousel when its own games overflow its share. Below 760px neither group
  gets a share: the row is one swipeable strip with live games first.
- A pinned game has a third line saying who scored last ("BUF TD: J.Allen
  1 Yd Rush", first names as initials), cut with an ellipsis, full play in
  the tooltip. It holds its
  space from kickoff to final ("No scoring yet" at 0 to 0) so the ticker's
  height does not jump on each score.
- Body text 13px, tables 12px, line-height 1.35. Headers in Barlow Condensed, bold.
- Links are blue and underlined. Player and team names are always links.
- Yellow is only ever a background (announcement strip, highlighted row),
  never text, since it fails contrast on white.
- Winners in bold, not colored.

### Scoreboard page

`/scores` is the week's full slate, the view a strip cannot give: every game
at once, grouped into kickoff slots, from the same `ticker.json`. It is
linked from the ticker's week label.

- A slot is an exact shared kickoff instant, so the grouping is identical in
  every time zone and only its heading changes. Headings are built in Eastern
  and rewritten in the visitor's zone, like the ticker's kickoff times.
- A game is a box: status bar, a row per team (chip, name link, score),
  winner in bold. A scheduled game has no status bar at all, since the slot
  heading above already carries the time; the bar appears with the clock at
  kickoff and stays for the final.
- Boxes stay in kickoff order. Unlike the ticker, live games are not moved to
  the front: the value here is a stable week, and a slate kicking off together
  already groups them.

### Charts

- Every chart is drawn through `pipelines/charts/style.py`, which reads colors and fonts
  from `tokens.css`. Charts go on the page inline, not as `<img>`, so their text is set
  in the site's self-hosted fonts and their logos load from the site. `style.save()`
  makes the SVG safe to inline: ids prefixed with the slug, matplotlib's global style
  rule scoped to the chart, no fixed size, no creation date (redraws are byte-identical).
- Each chart is one image to a screen reader: `role="img"`, named by its title and
  described by its note.
- No title inside a chart; the page shows it. Yellow only as a background band, never a
  line, dot or text. Series colors are `style.SERIES`, all 3:1 or better on white.
  Label lines at their ends (`style.label_ends`, which keeps labels apart) rather than
  with a legend or color alone. Team logos (`style.team_logo`) stand in for team labels.
  Mark a moment with `style.callout` (a dot, a boxed two-line label, a leader). Text in
  a chart box is left-aligned: matplotlib measures in a wider stand-in for Barlow, so
  centered or right-aligned lines drift once the page draws them.
- A full-size chart can be read point by point: hover, drag, or focus it and use the arrow
  keys, Home and End. A guide line (along x) and a dot mark the point, a boxed readout shows
  its lines, and each readout is announced to screen readers. The data comes from
  `style.save(..., hover={...})`, written as `<slug>.hover.json` beside the SVG: the plot
  area in viewBox units, the axis ranges, and the points. The page embeds it (no fetch);
  `src/lib/charts/hover.ts` does the math and `hover-dom.ts` the wiring. Nothing animates.
  On touch, a drag reads the chart only where the whole chart fits; where the frame scrolls
  sideways (phones), a drag scrolls and a tap reads. Thumbnails have no hover.
- The auto chart's templates all carry hover data: win probability, every play (clock,
  who is favored after it, what happened, the swing when at least 1%; marker rows and
  unnamed stoppages left out, timeouts named), plus kickoff and the result; the EPA
  scatter, each team's values and ranks; the yards race, each week's totals.
- `/charts` lists Tyler's charts and every kept auto chart together: newest first, 12 to a page, a static page per tag
  (`/charts/tag/<tag>/`, no script), and a page per chart with its note, date, author,
  source and tags. Chart names cannot be all digits or `tag` (those URLs are taken).
  The build fails on an entry with no SVG, a script not in `mine/`, two featured, or a
  name a kept auto chart already has. Auto charts are bylined "Auto chart" and tagged
  Auto plus their kind (Win probability, EPA, Yards race), so `/charts/tag/auto/` is
  all of them. Only Tyler's can be featured.
- A gallery card shows the logos of the teams a chart is about beside its title (the
  ones inside the chart are too small at thumbnail size), each linking to its team page: `teams` in an auto chart's
  entry (away, home on WP charts), or optional `teams: [BUF, KC]` in one of Tyler's.
  The build fails on an abbreviation that is not a team.
- The home page's chart panel is full width under the 4th down panel: Tyler's featured
  chart with its date, else the auto chart labeled "Auto chart" with what its data
  covers, else an empty state.

### Right rail

- On every page, top to bottom: the playoff picture, then on this day.
- There is no games list in the rail: the ticker right above shows the same games (one was
  tried and removed as a duplicate that made the rail heavy).
- Playoff picture (`PlayoffPicture.astro`, from `standings.json`): each conference's seeds 1
  to 7 and the next two in the hunt, side by side, team chips with records, a rule under 7,
  the hunt dimmed, linking to `/standings`. (A plain-text version without chips was tried
  and Tyler preferred the chips.) Before a season's first game it is titled with last
  season's final seeding, since that is what `standings.json` holds then.

### Stat leaders page

- `/stats` shows the top 5 in eight categories in equal panels (as many to a row as fit
  at 300px): passing, rushing and receiving yards, sacks, interceptions, field goals made,
  EPA per dropback and rush EPA per carry. Equal values share a rank; when the last place
  shown is shared by more players than fit, the rest are counted ("31 more tied at 1")
  rather than listed. Counting stats list only players above zero. Each panel says what
  it is through; the EPA panels also say who qualifies and that they update Wednesdays.
  The rule is `topOf` in `src/lib/stats/top.ts`.

### Standings page

- Standings has a tab per conference, links like the team pages' (`Tabs.astro`, shared):
  `/standings/` is the AFC, `/standings/nfc/` the NFC. Team pages link to their own
  conference's tab.
- Each tab: the conference's four divisions (W, L, T, Pct, PF, PA, Diff, Div, Conf, Strk), each
  with a note wherever teams on the same record were ordered by a tiebreaker ("NE and
  NYJ are both 1-1; NE is ahead on strength of victory"), then the conference's seeds
  1 to 16 with a heavier rule under 7 and the step that placed each team. Seeds 1 to 4
  are division leaders, whatever their record. Pct is written the NFL way (.667, 1.000).
- Standings is in the nav, first after Home.

### Curated posts

`/curated` lists X and Bluesky posts Tyler picked, newest first by the post's date, each
as a quote card beside his note. Entries are added by hand, one file each in
`src/content/curated/`:

```md
---
url: https://bsky.app/profile/handle.bsky.social/post/3lxyz...
platform: bluesky        # or x
author: Their Name
handle: handle.bsky.social
date: 2026-09-20         # when it was posted
text: |
  The post's words, line breaks kept.
note: Why it is here.
added: 2026-09-21        # optional: when it was copied
---
```

- No embeds and no third-party scripts, ever. The card is built only from those fields;
  the page fetches nothing from either platform. Its only links out are the author's
  profile and the original post. Links inside the text stay plain text.
- Never store or show a post's images or video. There is no image field and the schema
  is strict, so one cannot be added; text that links to either platform's media hosts
  fails the build. No avatars either.
- The build also fails when the url is not a single post, is from another platform, or
  names a different account than `handle` (a Bluesky link by DID is not compared).
  The rules live in `src/lib/curated/posts.ts`.
- The note carries as much weight as the post: two boxed units of equal width and the
  same text size, side by side, stacked (post first) below 760px. The platform is named
  in words, never with a logo. The text is a copy, so `added` shows when it was taken.
- Curated is in the nav (Tyler's call; it was going to be an Articles page link).
- An empty collection (curated before the first post, charts if the example is deleted
  first) builds without Astro's two empty-collection warnings: `entries()` in
  `src/content.config.ts` skips an empty folder and `entriesOf()` in
  `src/utils/collections.ts` skips `getCollection`. Use both for any collection that
  can be empty.

### Panel structure

- Panels sit on the gray page with a 12px gap and a 1px `--rule` border.
- Every panel has a header bar: `--header` background, white title, 6px 10px padding.
- Inside panels, group content into boxed units (score boxes, mini tables)
  with 1px borders or dotted `--rule-soft` dividers.
- Tables: 1px borders on every cell, compact padding (2px 6px),
  right-aligned tabular numbers.

## Quality bar

- `npm run build` passes with no warnings you introduced.
- `npm test` (live ticker, Node's built-in test runner) and `python -m unittest discover -s pipelines` pass.
- Works under the `/tylernfl` base path (test with `npm run preview`).
- Keyboard focus visible, color contrast passes WCAG AA, semantic HTML for tables.
- Realistic mock data (real-looking names, numbers, and string lengths), no lorem ipsum.
- Loading and empty states exist for every data panel (e.g. offseason: no games today).

## Writing style for UI copy

Plain, specific, sentence case. Name things by what the user sees ("Stat leaders", "4th down calculator"), not by implementation. Never use em dashes in UI copy or docs.

## Working agreements

- Work in the build order below, one step at a time. Stop after each step and summarize what changed.
- Ask before adding a dependency not listed here.
- Keep tokens in `tokens.css` only; components never hardcode colors or spacing.

## Build order

1. Astro scaffold, tokens, global styles, deploy workflow
2. Layout shell with placeholder cells
3. Core components: Panel, StatTable, StatCard, TickerItem, TeamChip
4. Mock pages: home, stat leaders, tools index, 4th down placeholder, articles index + one sample article, about, 404
5. Responsive pass
6. Loading, empty, and hover states
7. (Later) daily/weekly workflows and Python pipeline stubs
8. Charts: a charts content collection with SVGs drawn by scripts in `pipelines/charts/`
   through a shared style module, a `/charts` gallery with tag filtering and a page per
   chart, and a featured chart on the home page (an auto-generated one when none is
   featured). Done; see Charts under Design direction.
9. Curated posts: hand-added X and Bluesky posts as native quote cards with the author
   credited and the original linked, no embeds, no third-party scripts, never any post
   images, and a `/curated` page where the note carries as much weight as the quote.
   Done; see Curated posts under Design direction.
10. Ticker steps one game at a time (done); standings and tiebreakers validated against
    nflseedR, and the `/standings` page (done).
11. Stats overview: top 5 in eight categories in equal panels, `player_epa.json` in the
    weekly job, `leaders.json` retired (done; see Stat leaders page).
12. Right rail: the model record placeholder removed, the playoff picture added (done; see
    Right rail).
13. Team hubs with a header strip and five static tabs, and `schedule.json` in the daily
    job (done; see Team pages). Playoff odds join the strip in step 14.
14. Playoff odds: `playoff_odds.json` daily, 10,000 simulations with the standings'
    tiebreakers, moneyline game probabilities through a pluggable function, shown on team
    pages (done; see the data contract and Team pages).

## Articles

- Articles are MDX in src/content/articles/, using an Astro content collection.
- Frontmatter: title, date, description, tags, draft (boolean).
- Drafts render in dev only, never in production builds.
- Site components (StatTable, charts) must be importable in MDX.
