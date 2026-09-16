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
│   ├── content/articles/   Markdown articles (content collection)
│   └── data/               JSON consumed at build time (mock now, pipeline output later)
├── pipelines/              Python jobs (stubs only for now)
├── models/                 exported model files (empty for now)
└── .github/workflows/      deploy.yml (now), daily.yml + weekly.yml (later)
```

## GitHub Pages rules

- `astro.config.mjs`: `site: 'https://tylerthompson17.github.io'`, `base: '/tylernfl'`.
- Every internal link and asset path must respect the base path (use `import.meta.env.BASE_URL` or a small `url()` helper). Hardcoded `/stats` style links will break in production.
- Deploy with the official `withastro/action` on push to `main`.

## Data contract

- Pipelines write JSON into `src/data/`, commit it, and the push triggers a rebuild. Pages read data at build time.
- Exception (later): the live 4th down page fetches game state at runtime in the browser.
- Mock JSON files must match the real schemas exactly, so pipelines can overwrite them without touching site code. Define a TypeScript type for each file in `src/data/types.ts`.
- Files: `ticker.json`, `leaders.json`, `on_this_day.json`, `teams.json`, `model_record.json`.
- `teams.json` (abbr, name, primary/secondary colors) should be generated from nflverse team data, not typed from memory. If that is not possible yet, leave colors as neutral placeholders and flag it.

## Design direction

Reference feel: StatMuse / FanDuel / ESPN layout pattern (score ticker, left nav, wide center, right rail), but **griddier**: one connected grid with shared hairline dividers instead of floating rounded cards.

Subject-grounded identity: the broadcast field. Dark slate like a night game, chalk white text, and the yellow first-down line as the single accent.

### Tokens (starting values, all in `tokens.css`)

| Token | Value | Use |
|---|---|---|
| `--bg` | `#0F1720` | page background |
| `--panel` | `#151F2B` | grid cells |
| `--panel-hover` | `#1B2735` | row/cell hover |
| `--rule` | `#2A3746` | all dividers |
| `--text` | `#E9EEF2` | primary text (chalk) |
| `--text-dim` | `#8A99A8` | secondary text |
| `--accent` | `#F2D22E` | first-down yellow, used sparingly |
| `--win` | `#3FB27F` | positive values |
| `--loss` | `#E0565B` | negative values |

- Spacing scale: 4, 8, 12, 16, 24, 32.
- Radius: 0 everywhere.
- Type: **Barlow** for body, **Barlow Condensed** for headings, panel titles, and ticker (scoreboard feel). All numeric cells use `font-variant-numeric: tabular-nums`; verify the font supports it and report if not.
- Labels in sentence case. No all-caps eyebrow labels, no monospace for data labels, no arrows appended to link text.
- Motion: none by default. Hover state changes background only. Respect `prefers-reduced-motion`.
- The accent is for one thing per view (active nav item, key number, live indicator). Not decoration.

### Grid technique

- Grid containers use `background: var(--rule); gap: 1px;` and each cell uses `background: var(--panel)`. The 1px gaps become shared dividers.
- Place cells explicitly so no empty tracks expose the rule color as a block.
- Outer page shell follows the same rule: ticker, header, sidebar, main, and rail are all cells of one grid.

### Shell

```
┌──────────────────────────────────────────────┐
│ score ticker (horizontal scroll)             │
├──────────────────────────────────────────────┤
│ header: wordmark, search (non-functional)    │
├─────────┬───────────────────────┬────────────┤
│ nav     │ main                  │ right rail │
│ 220px   │ fluid                 │ 320px      │
└─────────┴───────────────────────┴────────────┘
```

- Below 1100px: right rail moves under main.
- Below 760px: nav collapses into a menu button in the header.
- Wide tables scroll horizontally inside their panel; the page body never scrolls sideways.

### Team identity

- Default: team abbreviation on the team's primary color (`TeamChip`), with accessible text contrast.
- No NFL or team logos in the site's own branding, wordmark, or favicon. Logos may be added later on large elements only; build `TeamChip` so a logo slot can be added without refactoring.
- Footer includes: "Not affiliated with or endorsed by the NFL or any team."

## Quality bar

- `npm run build` passes with no warnings you introduced.
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
