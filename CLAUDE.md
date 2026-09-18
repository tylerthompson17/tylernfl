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
│   ├── pages/              index, tools/, stats/, articles/, about, 404
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
  1. **Live ticker scores** (`src/lib/live-ticker/`). During game windows (15 minutes before each unfinished game's kickoff to 4.5 hours after), the browser polls ESPN's public scoreboard (`site.api.espn.com`) every 30 seconds while the tab is visible and updates ticker scores in place. It matches games by `espnId`, never moves a game backwards (final stays final), backs off on errors, and leaves the `ticker.json` data showing on any failure. Turn it off entirely with `LIVE_TICKER_ENABLED` in `src/config.ts`. Requests must stay plain GETs with no custom headers (ESPN rejects CORS preflight). The API is unofficial and can change or disappear without notice.
  2. **Live 4th down page** (later): fetches game state at runtime.
- ESPN data is browser-only: never write it to `src/data/` and never use it in pipelines. Pipelines use nflverse (the `espnId` in `ticker.json` comes from nflverse schedules). Test fixtures in `tests/fixtures/espn/` are the only stored ESPN data.
- Upcoming kickoff times display in the visitor's time zone, formatted in the browser from the UTC `kickoff` field (not from ESPN's text).
- In-progress parsing (quarter, clock, halftime) is provisional until verified against the real capture from DET at BUF on 2026-09-17.
- Mock JSON files must match the real schemas exactly, so pipelines can overwrite them without touching site code. Define a TypeScript type for each file in `src/data/types.ts`.
- Files: `ticker.json`, `leaders.json`, `stats/{board}.json`, `rosters/{TEAM}.json`,
  `team_stats.json`, `on_this_day.json`, `teams.json`, `model_record.json`.
- `teams.json` (abbr, name, primary/secondary colors) should be generated from nflverse team data, not typed from memory. If that is not possible yet, leave colors as neutral placeholders and flag it.
- `ticker.json`, `leaders.json`, `stats/` and `rosters/` are real data written by
  `pipelines/run_daily.py` (nflreadpy), run daily by `.github/workflows/daily.yml`.
  nflverse calls the Rams `LA`; pipelines normalize it to `LAR`.
- `stats/{board}.json` holds the full player leaderboards (passing, rushing, receiving,
  defense, kicking). The pipeline decides values, ranks and who qualifies; the site only
  sorts and switches totals / per game in the browser. Qualifying bars are per team game
  and are this site's choice, set in `pipelines/leaderboards.py`.
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
- `model_record.json` stays a placeholder until the 4th down model exists. `on_this_day.json` is still mock data.

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
  - The ticker is a looping carousel. It pauses on hover and keyboard focus,
    and stays a static, swipeable strip on touch devices, for reduced motion,
    and when the week's games fit.
  - When a live score changes, the new number gets a brief yellow background
    that fades out (2s). Off under reduced motion.
- Live games are pinned between the week label and the carousel, capped at
  half the ticker's width (scrolling by hand past that). Below 760px the
  ticker is one swipeable strip with live games first.
- Body text 13px, tables 12px, line-height 1.35. Headers in Barlow Condensed, bold.
- Links are blue and underlined. Player and team names are always links.
- Yellow is only ever a background (announcement strip, highlighted row),
  never text, since it fails contrast on white.
- Winners in bold, not colored.

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
