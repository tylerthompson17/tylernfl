# 4th down model interface

What the 4th down calculator page (`src/pages/tools/4th-down.astro`), the live 4th down
page and the sidebar record expect from the model. The model is Tyler's. This file
records the contract; the decisions in it are Tyler's (2026-10-21), and anything still
open is listed at the end.

Status on 2026-10-21: the types are in `src/lib/fourth-down.ts`. `recommend()` is a stub
that throws, and the calculator page does not call it yet. The sidebar record panel and
`model_record.json` were removed on 2026-09-22 (commit 3a116f0) and come back in the
shape below when the model exists.

## Conventions

- **Probabilities are 0 to 1** everywhere in data and contracts, as in every other data
  file (`playoff_odds.json`). They become percents only when displayed.
- **Field position is `yardline100`**: yards to the opponent's goal line, nflfastR's
  `yardline_100`. 100 is the offense's own goal line, 1 the opponent's 1. Anything that
  receives field position another way converts at that boundary: the live page converts
  from ESPN's situation in its parser, and the calculator form converts from its own
  inputs. `FieldStrip.astro` keeps its own left to right drawing coordinate and is given
  `100 - yardline100`.
- **Teams** are the site's abbreviations (`LAR`, not nflverse's `LA`). The exported
  model maps them if it was trained on nflverse's.
- **Kicker ids are ESPN athlete ids**, as strings.

## 1. Calculator: function signature

```ts
export function recommend(situation: FourthDownSituation): FourthDownRecommendation;
```

Synchronous, one situation in, one recommendation out. It runs in the browser from the
exported model JSON in `models/` (see section 3).

### Input: `FourthDownSituation`

| Field | Type | Unit and range | Notes |
|---|---|---|---|
| `season` | number | | |
| `posteam` | string | team abbreviation | The offense. |
| `defteam` | string | team abbreviation | |
| `home` | string or null | team abbreviation | The home team; null at a neutral site. |
| `yardline100` | number | yards to the opponent's goal line, 1 to 99 | |
| `distance` | number | yards to gain for a first down | Goal to go is `distance = yardline100`. |
| `secondsRemaining` | number | seconds left in the game (regulation: 0 to 3600) | |
| `halfSecondsRemaining` | number | seconds left in the half, 0 to 1800 | |
| `scoreDiff` | number | points, offense minus defense | Negative when the offense trails. |
| `timeoutsOffense` | number | 0 to 3 | |
| `timeoutsDefense` | number | 0 to 3 | |
| `receives2ndHalfKickoff` | boolean | | True when the offense receives the second half kickoff. Only matters in the first half. |
| `roof` | `'outdoors' \| 'dome' \| 'closed' \| 'open'` | | nflfastR's `roof` values. |
| `temp` | number or null | degrees Fahrenheit | Null under a roof or when unknown, as in nflfastR. |
| `kickerId` | string, optional | ESPN athlete id | Missing means a league-average kicker. |

### Output: `FourthDownRecommendation`

| Field | Type | Unit | Notes |
|---|---|---|---|
| `call` | `'go' \| 'punt' \| 'field goal'` | | The option with the highest win probability. |
| `wpGo` | number | 0 to 1 | Offense's win probability if it goes for it. |
| `wpPunt` | number or null | 0 to 1 | Null when a punt is not a realistic option. |
| `wpFieldGoal` | number or null | 0 to 1 | Null when a field goal is not a realistic option. |
| `conversionProb` | number | 0 to 1 | Chance of gaining the first down if the offense goes. |
| `fgMakeProb` | number or null | 0 to 1 | Null when `wpFieldGoal` is. |
| `kicker` | `{ id: string \| null, leagueAverage: boolean }` | | The kicker the numbers used. `leagueAverage` is true, and `id` null, when no `kickerId` was given or the model does not know it. The page must say so. |
| `breakdown` | `FourthDownBreakdown` | | Per-term breakdown, below. |

Which option counts as realistic is the model's call; the page shows a null option as
not available.

### Per-term breakdown

Each option's win probability split into the outcomes it averages over, so the page can
show where the number comes from:

- `go`: `conversionProb`, `wpIfConvert`, `wpIfFail`, with
  `wpGo = conversionProb * wpIfConvert + (1 - conversionProb) * wpIfFail`.
- `fieldGoal` (null when not realistic): `makeProb`, `wpIfMake`, `wpIfMiss`, combined the
  same way.
- `punt` (null when not realistic): `wpAfterPunt`, the win probability after the punt
  (already averaged over where it lands).

All are 0 to 1. Whether the model computes its options this way is Tyler's choice; the
breakdown only has to add up to the option's win probability.

## 2. Sidebar record: `model_record.json`

A list of graded calls for one season, written by a pipeline into `src/data/`. Season
totals are derived from the list by the site, never stored.

```ts
interface ModelRecordData {
  season: number;
  /** ISO timestamp of the last pipeline run */
  updated: string;
  /** Minimum WP gap for a play to be graded (0 to 1); starts at 0.02 */
  threshold: number;
  calls: GradedCall[];
  /** Season-level calibration, null until there are enough plays */
  calibration: CalibrationSummary | null;
}

interface GradedCall {
  /** nflverse game_id, e.g. "2026_07_BUF_KC" */
  gameId: string;
  /** nflverse play_id */
  playId: number;
  week: number;
  /** Play description as nflverse publishes it */
  description: string;
  situation: FourthDownSituation;
  coachCall: 'go' | 'punt' | 'field goal';
  modelCall: 'go' | 'punt' | 'field goal';
  wpGo: number;
  wpPunt: number | null;
  wpFieldGoal: number | null;
  /** WP of the model's call minus WP of the coach's: what the coach's choice cost */
  wpCost: number;
}
```

### What a graded call is

Grading is by decision, not by outcome. A 4th down play is graded when:

1. the coach's choice differs from the model's call, and
2. the gap between the model's call and the coach's choice is at least `threshold` in
   win probability (0.02 to start; configurable in the pipeline, and written into the
   file so the page can state it).

The graded value is `wpCost = wp(modelCall) - wp(coachCall)`, the win probability the
coach's choice cost, as of the moment of the decision. What happened on the play does
not change it: a go that fails and a go that converts cost the same.

Derived totals the page can show: number of graded calls, total and average WP cost,
and either of those per team.

### Model accuracy

Accuracy is reported separately from the record, as a season-level calibration summary
of the model's win probabilities against what happened, not per play:

```ts
interface CalibrationSummary {
  /** Plays the summary covers */
  plays: number;
  /** Mean squared error of the predicted WP against the result (0 to 1, lower is better) */
  brier: number;
  /** Predicted WP in bins, against how often those teams won */
  bins: { lo: number; hi: number; predicted: number; observed: number; plays: number }[];
}
```

Which plays and which predictions it covers is Tyler's to define with the model.

## 3. Where the model runs

In the browser, from exported JSON in `models/`. The calculator imports it at build time
and ships it with the page; it is not fetched at runtime, so it stays within the data
contract (the only runtime fetches are live scores and, later, the live 4th down page's
game state). Its size counts toward the page's weight.

## Site copy

The 4th down article ("What the record will mean") and the about page describe
decision-based grading (updated 2026-10-21). The article states the threshold as 2
points of win probability; change it there if `threshold` changes.

Before restoring the old sidebar panel from git history, note that it showed a
wins-losses-pushes record. It needs to show the derived totals instead.

## Open questions

1. **Kicker list for the calculator.** `rosters/{TEAM}.json` carries gsis ids, not ESPN
   ids. A kicker picker needs ESPN ids, which pipelines can take from nflverse's player
   table (`espn_id`), the same way `espnId` in `ticker.json` comes from nflverse
   schedules. The pipeline writing `model_record.json` needs the same mapping to fill
   `situation.kickerId`, and model training on nflverse play-by-play (gsis
   `kicker_player_id`) needs it to export ESPN ids.
2. **Coach's call the model rated unrealistic.** If the coach tries a field goal the
   model gave `wpFieldGoal: null`, the cost has no value. Grade it against something,
   or skip it?
3. **Which plays are 4th down decisions.** Fakes, plays wiped out by penalties, kneels
   and spikes, and overtime all need a rule in the grading pipeline.
4. **Overtime.** `secondsRemaining` and `halfSecondsRemaining` are undefined there.
