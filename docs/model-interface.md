# 4th down model interface

What the 4th down calculator page (`src/pages/tools/4th-down.astro`), the live 4th down
page and the sidebar record expect from the model. The model is Tyler's. This file
records the contract; the decisions in it are Tyler's (2026-10-21), and anything still
open is listed at the end.

Status on 2026-10-21: the types are in `src/lib/fourth-down.ts`. `recommend()` is a stub
that returns `{ supported: false, reason: 'unavailable' }`, and the calculator page does
not call it yet. The sidebar record panel and
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
export function recommend(situation: FourthDownSituation): FourthDownResult;

type FourthDownResult =
  | ({ supported: true } & FourthDownRecommendation)
  | { supported: false; reason: 'overtime' | 'unavailable' };
```

Synchronous, one situation in, one result out. It runs in the browser from the
exported model JSON in `models/` (see section 3).

`recommend()` never throws. A situation it does not cover returns
`{ supported: false, reason }` with no win probabilities or other values, and the page
says why:

- `'overtime'`: overtime is not supported in v1 (`overtime: true`).
- `'unavailable'`: the model is not in the site yet. The stub returns this for every
  situation until the real model replaces it.

The `reason` union can grow if other cases are ruled out later.

### Input: `FourthDownSituation`

| Field | Type | Unit and range | Notes |
|---|---|---|---|
| `season` | number | | |
| `posteam` | string | team abbreviation | The offense. |
| `defteam` | string | team abbreviation | |
| `home` | string or null | team abbreviation | The home team; null at a neutral site. |
| `yardline100` | number | yards to the opponent's goal line, 1 to 99 | |
| `distance` | number | yards to gain for a first down | Goal to go is `distance = yardline100`. |
| `overtime` | boolean | | True in any overtime period. v1 returns not supported. |
| `secondsRemaining` | number | seconds left in regulation, 0 to 3600 | Not read in overtime. |
| `halfSecondsRemaining` | number | seconds left in the half, 0 to 1800 | Not read in overtime. |
| `scoreDiff` | number | points, offense minus defense | Negative when the offense trails. |
| `timeoutsOffense` | number | 0 to 3 | |
| `timeoutsDefense` | number | 0 to 3 | |
| `receives2ndHalfKickoff` | boolean | | True when the offense receives the second half kickoff. Only matters in the first half. |
| `roof` | `'outdoors' \| 'dome' \| 'closed' \| 'open'` | | nflfastR's `roof` values. |
| `temp` | number or null | degrees Fahrenheit | Null means unknown. Not read when `roof` is `'dome'` or `'closed'`. |
| `kickerId` | string, optional | ESPN athlete id | Missing means a league-average kicker. |

### Output: `FourthDownRecommendation`

| Field | Type | Unit | Notes |
|---|---|---|---|
| `call` | `'go' \| 'punt' \| 'field goal'` | | The option with the highest win probability. |
| `wpGo` | number | 0 to 1 | Offense's win probability if it goes for it. |
| `wpPunt` | number or null | 0 to 1 | Null when a punt is not a realistic option. |
| `wpFieldGoal` | number or null | 0 to 1 | Null when the kick would be longer than the maximum field goal distance (below). |
| `conversionProb` | number | 0 to 1 | Chance of gaining the first down if the offense goes. |
| `fgMakeProb` | number or null | 0 to 1 | Null when `wpFieldGoal` is. |
| `kickDistance` | number | yards | The field goal distance the model used. Always present, so the page can show it when the kick is too long and `wpFieldGoal` is null. |
| `kickerId` | string or null | ESPN athlete id | The kicker the numbers used; null when they used a league-average kicker. |
| `flags` | `{ temperatureUnknown: boolean, kickerUnknown: boolean }` | | What the model had to assume, below. The page must say so for each one set. |
| `breakdown` | `FourthDownBreakdown` | | Outcome and term breakdown, below. |

### Flags

- `temperatureUnknown`: `temp` was null in a game where it is read (`roof` is
  `'outdoors'` or `'open'`). Under a dome or closed roof temperature is not read, so a
  null there is not unknown and the flag stays false.
- `kickerUnknown`: no `kickerId` was given, or the model does not know it. The numbers
  use a league-average kicker and `kickerId` in the output is null.

Both are always present, false when nothing was assumed.

A null option shows on the page as not available.

### Maximum field goal distance

`wpFieldGoal`, `fgMakeProb` and the field goal breakdown are null when the kick distance
is over `maxFieldGoalDistance`, 70 yards to start.

The site passes only `yardline100`. The model computes the kick distance itself, from
`yardline100` and an offset stored in the exported model JSON (`kickDistanceOffset`,
measured at 18 yards), and returns it as `kickDistance`. The site never computes a kick
distance of its own: wherever one is shown, it is `kickDistance` from the response.

Both values live in the exported model JSON in `models/`, so changing either needs no
site code.

Whether a punt is realistic is the model's call.

### Breakdown

`breakdown` has one entry per option, null when that option is. Each entry carries two
views of the same number: the outcomes the option averages over, and the terms that
move it.

```ts
interface FourthDownBreakdown {
  go: { outcomes: GoOutcomes; terms: TermBreakdown };
  punt: { outcomes: PuntOutcomes; terms: TermBreakdown } | null;
  fieldGoal: { outcomes: FieldGoalOutcomes; terms: TermBreakdown } | null;
}

interface GoOutcomes { conversionProb: number; wpIfConvert: number; wpIfFail: number }
interface FieldGoalOutcomes { makeProb: number; wpIfMake: number; wpIfMiss: number }
interface PuntOutcomes { wpAfterPunt: number }

interface TermBreakdown {
  /** The option's WP with every term turned off */
  wpAllTermsOff: number;
  /** Each term's contribution, in the order the page lists them */
  terms: { term: string; wpDelta: number }[];
  /** What the terms do not explain */
  residual: number;
}
```

**Outcomes.** All 0 to 1, and they combine to the option's win probability:

- go: `wpGo = conversionProb * wpIfConvert + (1 - conversionProb) * wpIfFail`, with
  `conversionProb` the same value as the top-level one.
- field goal: `wpFieldGoal = makeProb * wpIfMake + (1 - makeProb) * wpIfMiss`, with
  `makeProb` equal to `fgMakeProb`.
- punt: `wpPunt = wpAfterPunt`, already averaged over where the punt lands.

**Terms.** Terms are the model's correction terms: adjustments it applies on top of
its uncorrected win probability, such as the kicker. They are not the situation inputs
(field position, score, clock), which are already in `wpAllTermsOff`, the option's win
probability with every correction turned off. For each option, the deltas and the
residual account for everything the corrections change:

```
sum of wpDelta + residual = wp(option) - wpAllTermsOff
```

so `wpAllTermsOff + sum of wpDelta + residual` is the option's win probability exactly.
`wpDelta` and `residual` are in win probability, -1 to 1, and may be negative. `term`
names are short labels naming the correction ("Kicker (H. Butker)"), shown on the page
as they are, so the model chooses them and they need no mapping on the site.
Which corrections there are, and what turning one off means, are Tyler's choices with
the model.

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

A play is never graded when `recommend()` returns `supported: false` for it (in v1, every
overtime play), since there is no recommendation to grade against. The other plays left
out, and how fakes count, are under "Decided" at the end.

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

### Decided (2026-10-21)

Grading rules for the pipeline that writes `model_record.json`:

- **Coach's choice is a null option: ungraded.** If the coach punts when `wpPunt` is
  null, or tries a field goal when `wpFieldGoal` is null (including one longer than
  `maxFieldGoalDistance`), the cost has no value and the play is not graded.
- **Fakes count as go.** A fake punt or fake field goal is graded as `coachCall: 'go'`.
- **Plays skipped:**
  - plays nullified by a penalty;
  - kneels and spikes;
  - plays where the game is already decided: every non-null option's win probability is
    below 0.02, or every one is above 0.98.
