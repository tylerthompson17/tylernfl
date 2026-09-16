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

- Radius 0, no shadows, no gradients, no motion.
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
