# Tyler NFL

Personal NFL analytics site: public tools (4th down model first), stat leaders, a daily "on this day" feature, and occasional articles. Hosted on GitHub Pages at `https://tylerthompson17.github.io/tylernfl`.

## Division of labor

- Claude Code owns: site scaffolding, layout, components, styling, data plumbing, GitHub Actions.
- Tyler owns: all statistical modeling (win probability, 4th down logic, team ratings). Do not write model logic. Leave clearly marked stubs and interfaces instead.

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
│   ├── pages/              index, scores, tools/, stats/, articles/, about, 404
│   ├── content/articles/   MDX articles (content collection)
│   └── data/               JSON consumed at build time (mock now, pipeline output later)
├── pipelines/              Python jobs: run_daily.py (ticker, leaders), build_teams.py
├── models/                 exported model files (empty for now)
└── .github/workflows/      deploy.yml, daily.yml (weekly.yml later)
```

## GitHub Pages rules

- `astro.config.mjs`: `site: 'https://tylerthompson17.github.io'`, `base: '/tylernfl'`.
- Every internal link and asset path must respect the base path (use `import.meta.env.BASE_URL` or a small `url()` helper). Hardcoded `/stats` style links will break in production.
- Deploy with the official `withastro/action` on push to `main`.

## Data contract

- Pipelines write JSON into `src/data/`, commit it, and the push triggers a rebuild. Pages read data at build time.
- Browser-side fetches are allowed in exactly two places. Nothing else fetches data at runtime.
  1. **Live scores** (`src/lib/live-ticker/`). During game windows (15 minutes before each unfinished game's kickoff to 4.5 hours after), the browser polls ESPN's public scoreboard (`site.api.espn.com`) every 30 seconds while the tab is visible and updates scores in place. One poll feeds every game on the page: the ticker slots and, on `/scores`, the boxes, which carry the same `data-game` hooks. It matches games by `espnId`, never moves a game backwards (final stays final), backs off on errors, and leaves the `ticker.json` data showing on any failure. Live games also show who scored last: when a live game's score changes, the browser fetches that one game's summary (`/summary?event=`) once, retrying up to 3 times over about a minute if it trails the scoreboard. It is never polled on a timer (it is about 175 KB, of which the scoring plays are about 1 KB), and it is one fetch per scoring play however many places render the line. Turn it all off with `LIVE_TICKER_ENABLED` in `src/config.ts`. Requests must stay plain GETs with no custom headers (ESPN rejects CORS preflight). The API is unofficial and can change or disappear without notice.
  2. **Live 4th down page** (later): fetches game state at runtime.
- Header search is not a runtime data fetch: its index (`search-index.js`, from
  `src/pages/search-index.js.ts`) is static build output, versioned per build, and the
  search box loads it as a script the first time it is used (about 50 KB gzipped). It
  covers every player page, every team and the site's pages; matching and ranking live
  in `src/lib/search/match.ts`. Nothing else may use this as a way to load data.
- ESPN data is browser-only: never write it to `src/data/` and never use it in pipelines. Pipelines use nflverse (the `espnId` in `ticker.json` comes from nflverse schedules). Test fixtures in `tests/fixtures/espn/` are the only stored ESPN data.
- Upcoming kickoff times display in the visitor's time zone, formatted in the browser from the UTC `kickoff` field (not from ESPN's text). That covers the ticker's upcoming slots and the `/scores` kickoff headings.
- In-progress parsing (quarter, clock, halftime, final) is verified against the real capture from DET at BUF on
  2026-09-17 (`tests/fixtures/espn/`). Not yet seen in a real response: an end of quarter status (ESPN showed the
  next quarter at 15:00 instead) and live overtime. Add a capture when one happens.
- Mock JSON files must match the real schemas exactly, so pipelines can overwrite them without touching site code. Define a TypeScript type for each file in `src/data/types.ts`.
- Files: `ticker.json`, `leaders.json`, `stats/{board}.json`, `players/{TEAM}.json`, `rosters/{TEAM}.json`,
  `transactions.json`, `team_stats.json`, `on_this_day.json`, `teams.json`, `model_record.json`.
- `teams.json` (abbr, name, primary/secondary colors) should be generated from nflverse team data, not typed from memory. If that is not possible yet, leave colors as neutral placeholders and flag it.
- `ticker.json`, `leaders.json`, `stats/`, `players/`, `rosters/`, `transactions.json` and `on_this_day.json` are real data written by
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
- Play-by-play goes through `pipelines/pbp_cache.py`: completed seasons are cached for
  good, the current season refreshes after 12 hours. CI persists the cache with
  `actions/cache`. Anything that needs pbp (including the 4th down model) should load
  it through this module rather than calling `nflreadpy.load_pbp` directly.
- `on_this_day.json` is real data written daily by `pipelines/on_this_day.py`: up to 3 notable games
  played on today's date (one per season, newest first), picked and worded only from nflverse schedule
  fields (score, round, overtime, closing spread, temperature). It covers games since 1999 and nothing
  else, so no hand-written history. Washington is named by city in every season, and relocated teams
  link to today's franchise page.
- `model_record.json` stays a placeholder until the 4th down model exists. It is the only
  placeholder data left on the site.

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
  - A ticker group is a looping carousel. It pauses on hover and keyboard
    focus, and stays a static, swipeable strip on touch devices, for reduced
    motion, and when its games fit.
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

## Articles

- Articles are MDX in src/content/articles/, using an Astro content collection.
- Frontmatter: title, date, description, tags, draft (boolean).
- Drafts render in dev only, never in production builds.
- Site components (StatTable, charts) must be importable in MDX.
