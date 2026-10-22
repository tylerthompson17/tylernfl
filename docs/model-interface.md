# 4th down model interface

What the 4th down calculator page (`src/pages/tools/4th-down.astro`), the live 4th down
page and the sidebar record expect from the model: the 4th down decision and the try
after a touchdown (kick the extra point or go for 2). The model is Tyler's. This file
records the contract; the decisions in it are Tyler's (2026-10-21), and anything still
open is listed at the end.

**Contract version 4** (2026-10-22). Changes are listed under "Version history" at the
end; bump the version with every change to a type or rule here, and `CONTRACT_VERSION`
in `src/lib/fourth-down.ts` with it.

Status on 2026-10-22: the types are in `src/lib/fourth-down.ts`. `recommend()` and
`recommendTry()` are stubs that return `{ supported: false, reason: 'unavailable' }`, and
the calculator page calls neither yet. The sidebar record panel and
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
  | { supported: false; reason: 'overtime' | 'unavailable' | 'endgame' };
```

Synchronous, one situation in, one result out. It runs in the browser from the
exported model JSON in `models/` (see section 4).

`recommend()` never throws. A situation it does not cover returns
`{ supported: false, reason }` with no win probabilities or other values, and the page
says why:

- `'overtime'`: overtime is not supported in v1 (`overtime: true`).
- `'endgame'`: 15 seconds or less left in the game (`secondsRemaining <= 15`, in
  regulation). The baseline the model is built on, nfl4th, does not compute these plays.
- `'unavailable'`: the model cannot be loaded or run: it is not in the site yet, its
  exported JSON is missing or fails to load, or evaluating it fails. Returned instead of
  throwing. The stub returns this for every situation until the real model replaces it.

The `reason` union can grow if other cases are ruled out later.

### Input: `FourthDownSituation`

| Field | Type | Unit and range | Notes |
|---|---|---|---|
| `season` | number | | |
| `posteam` | string | team abbreviation | The offense. |
| `defteam` | string | team abbreviation | |
| `home` | string | team abbreviation | The home team. At a neutral site, the nominal home team (the nflverse convention, which nfl4th was trained on). |
| `yardline100` | number | yards to the opponent's goal line, 1 to 99 | |
| `distance` | number | yards to gain for a first down | Goal to go is `distance = yardline100`. |
| `overtime` | boolean | | True in any overtime period. v1 returns not supported. |
| `secondsRemaining` | number | seconds left in regulation, 0 to 3600 | Not read in overtime. |
| `halfSecondsRemaining` | number | seconds left in the half, 0 to 1800 | Not read in overtime. |
| `scoreDiff` | number | points, offense minus defense | Negative when the offense trails. |
| `timeoutsOffense` | number | 0 to 3 | |
| `timeoutsDefense` | number | 0 to 3 | |
| `homeOpeningKickoff` | boolean | | True when the home team received the opening kickoff. |
| `roof` | `'outdoors' \| 'dome' \| 'closed' \| 'open'` | | nflfastR's `roof` values. |
| `temp` | number or null | degrees Fahrenheit | Null means unknown. Not read when `roof` is `'dome'` or `'closed'`. |
| `kickerId` | string, optional | ESPN athlete id | Missing means a league-average kicker. |
| `spreadLine` | number or null | points | Pregame spread, positive when the home team is favored (nflverse `spread_line`, the same convention as `spreadLine` in `schedule.json`). Null means unknown. |
| `totalLine` | number or null | points | Pregame total (over/under). Null means unknown. |

### Output: `FourthDownRecommendation`

| Field | Type | Unit | Notes |
|---|---|---|---|
| `call` | `'go' \| 'punt' \| 'field goal'` | | The option with the highest win probability. Null options are skipped. An exact tie goes to the first of `'go'`, `'field goal'`, `'punt'` in that order. |
| `wpGo` | number | 0 to 1 | Offense's win probability if it goes for it. |
| `wpPunt` | number or null | 0 to 1 | Null when a punt is not a realistic option. |
| `wpFieldGoal` | number or null | 0 to 1 | Null when the kick would be longer than the maximum field goal distance (below). |
| `conversionProb` | number | 0 to 1 | Chance of gaining the first down if the offense goes. |
| `fgMakeProb` | number or null | 0 to 1 | Null when `wpFieldGoal` is. |
| `kickDistance` | number | yards | The field goal distance the model used. Always present, so the page can show it when the kick is too long and `wpFieldGoal` is null. |
| `kickerId` | string or null | ESPN athlete id | The kicker the numbers used; null when they used a league-average kicker. |
| `flags` | `{ temperatureUnknown: boolean, kickerUnknown: boolean, linesUnknown: boolean }` | | What the model had to assume, below. The page must say so for each one set. |
| `breakdown` | `FourthDownBreakdown` | | Outcome and term breakdown, below. |

### Flags

A flag means an input the model uses was missing and a fallback was applied. A flag is
never set for an input the model does not use, whether or not it was given.

- `temperatureUnknown`: `temp` was null in a game where it is read (`roof` is
  `'outdoors'` or `'open'`) and the model uses temperature. Under a dome or closed roof
  temperature is not read, so a null there is not unknown and the flag stays false.
- `kickerUnknown`: the model uses a kicker-specific term, and no `kickerId` was given or
  the model does not know it. The numbers use a league-average kicker and `kickerId` in
  the output is null.
- `linesUnknown`: true whenever `spreadLine` or `totalLine` is null. Each fallback
  applies only to the line that is missing:
  - `spreadLine` null: the model uses a pick'em spread (0).
  - `totalLine` null: the model uses the median `total_line` from the most recent
    completed season.

  The same rule applies to the try (section 2).

All are always present, false when nothing was assumed.

Under the baseline (no correction terms), which reads neither the kicker nor the
temperature, `kickerUnknown` and `temperatureUnknown` are always false and `kickerId`
in the output is null; the page's explanation text says the kicker is treated as league
average. `linesUnknown` is unchanged: the baseline uses both lines, so it is set
whenever either is null. Example: `{ roof: 'outdoors', temp: null, kickerId: undefined,
spreadLine: -3, totalLine: 44.5 }` under the baseline returns `flags: {
temperatureUnknown: false, kickerUnknown: false, linesUnknown: false }` and `kickerId:
null`.

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

interface GoOutcomes { conversionProb: number; wpIfConvert: number | null; wpIfFail: number }
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
  `conversionProb` the same value as the top-level one. `wpIfConvert` is null when no
  gain can reach the line to gain (4th and more than 65); `conversionProb` is then 0 and
  `wpGo = wpIfFail`, so the identity still holds with the convert term at weight 0.
  Example: `{ yardline100: 90, distance: 70, ... }` returns `conversionProb: 0`,
  `wpIfConvert: null` and `wpGo` equal to `wpIfFail`. 4th and 65 at the same spot still
  has a convert branch (a 65-yard gain) and a numeric `wpIfConvert`.
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

## 2. The try after a touchdown: function signature

```ts
export function recommendTry(situation: TrySituation): TryResult;

type TryResult =
  | ({ supported: true } & TryRecommendation)
  | { supported: false; reason: 'overtime' | 'unavailable' | 'endgame' };
```

A separate decision with its own inputs and outputs, so it has its own function and
types rather than extending `recommend()`. Synchronous, never throws, and runs in the
browser from the exported model JSON, like `recommend()`. The unsupported reasons mean
the same as for `recommend()` (section 1): `'overtime'` and `'endgame'` because nfl4th
computes no tries in overtime or with 15 seconds or less left in the game, and
`'unavailable'` when the model cannot be loaded or run, which the stub returns for every
situation.

### Input: `TrySituation`

The game state right after the touchdown, before the try.

| Field | Type | Unit and range | Notes |
|---|---|---|---|
| `season` | number | | |
| `posteam` | string | team abbreviation | The team that scored and is attempting the try. |
| `defteam` | string | team abbreviation | |
| `home` | string | team abbreviation | As in `FourthDownSituation`. |
| `overtime` | boolean | | True in any overtime period. Returns not supported. |
| `secondsRemaining` | number | seconds left in regulation, 0 to 3600 | |
| `halfSecondsRemaining` | number | seconds left in the half, 0 to 1800 | |
| `scoreDiff` | number | points, try team minus opponent, **after the touchdown** | See below. |
| `timeoutsOffense` | number | 0 to 3 | The try team's timeouts. |
| `timeoutsDefense` | number | 0 to 3 | |
| `homeOpeningKickoff` | boolean | | As in `FourthDownSituation`. |
| `roof` | `'outdoors' \| 'dome' \| 'closed' \| 'open'` | | |
| `spreadLine` | number or null | points | As in `FourthDownSituation`. |
| `totalLine` | number or null | points | As in `FourthDownSituation`. |

**`scoreDiff` is after the touchdown, before the try.** It counts the touchdown's 6
points and nothing from the try. Example: a team down 14 scores a touchdown, so
`scoreDiff = -8`. Kicking makes it -7, a 2-point conversion -6. This is nflverse's
`score_differential` on the try play, which is what nfl4th reads.

No field position, distance, temperature or kicker: nfl4th's extra point probability is
a league-average 33-yard kick (its field goal model at `yardline100` 15), and its
2-point model reads only the season era, the roof and the pregame lines.

### Output: `TryRecommendation`

| Field | Type | Unit | Notes |
|---|---|---|---|
| `call` | `'kick' \| 'go for 2'` | | The option with the higher win probability. An exact tie is `'go for 2'` (nfl4th's rule). |
| `wpKick` | number | 0 to 1 | Try team's win probability if it kicks the extra point. |
| `wpGoForTwo` | number | 0 to 1 | Try team's win probability if it goes for 2. |
| `patMakeProb` | number | 0 to 1 | |
| `twoPointConvProb` | number | 0 to 1 | |
| `flags` | `{ linesUnknown: boolean }` | | As in `FourthDownRecommendation` (see Flags in section 1). |
| `breakdown` | `TryBreakdown` | | Below. |

```ts
interface TryBreakdown {
  kick: { outcomes: TryOutcomes; terms: TermBreakdown };
  goForTwo: { outcomes: TryOutcomes; terms: TermBreakdown };
}

interface TryOutcomes {
  /** makeProb for the kick, conversion probability for going for 2 */
  successProb: number;
  /** WP after the try succeeds: +1 for the kick, +2 for going for 2 */
  wpIfSuccess: number;
  /** WP after the try fails (+0); the same value in both options */
  wpIfFail: number;
}
```

- kick: `wpKick = successProb * wpIfSuccess + (1 - successProb) * wpIfFail`, with
  `successProb` equal to `patMakeProb`.
- go for 2: `wpGoForTwo = successProb * wpIfSuccess + (1 - successProb) * wpIfFail`,
  with `successProb` equal to `twoPointConvProb`.
- `TermBreakdown` is the type in section 1. The baseline has no correction terms for
  the try, so `terms` is empty, `residual` is 0, and `wpAllTermsOff` is the option's win
  probability.

Grading of tries in `model_record.json` is not part of the contract yet.

## 3. Sidebar record: `model_record.json`

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
overtime play and every play with 15 seconds or less left in the game), since there is
no recommendation to grade against. The other plays left out, and how fakes count, are
under "Decided" at the end.

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

## 4. Where the model runs

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

## Version history

- **4** (2026-10-22), from the fourth-down repo's contract change request (issue #3,
  milestone 4, the export pipeline):
  - Flags: a flag means an input the model uses was missing and a fallback was applied,
    and is never set for an input the model does not use. Under the baseline
    `kickerUnknown` and `temperatureUnknown` are always false.
  - `recommend()`'s `call` skips null options, and an exact tie goes to the first of
    `'go'`, `'field goal'`, `'punt'`.
  - `GoOutcomes.wpIfConvert` is `number | null`: null on 4th and more than 65, where no
    gain reaches the line to gain, with `conversionProb` 0 and `wpGo = wpIfFail`.
- **3** (2026-10-22), from the fourth-down repo's contract change request (issue #1:
  the decision baseline also ports nfl4th's `add_2pt_probs()`, matching its R output on
  all 16,702 tries from 2014 to 2025):
  - New `recommendTry()` with `TrySituation`, `TryResult`, `TryRecommendation`,
    `TryBreakdown` and `TryOutcomes` (section 2). `recommend()` and the 4th down types
    are unchanged.
  - `'unavailable'` covers a model that cannot be loaded or run, not only one that is
    not in the site yet, for both `recommend()` and `recommendTry()`.
  - Missing lines, both decisions: each fallback applies only to the missing line, and
    a missing total uses the median `total_line` of the most recent completed season,
    not the league-average total (fourth-down milestone 4).
- **2** (2026-10-22), from the fourth-down repo's contract change request (milestone 3:
  the decision baseline is a Python port of nfl4th at commit `ecb7293`, matching its R
  output on all 49,416 4th downs from 2014 to 2025):
  - `FourthDownSituation` gains `spreadLine` and `totalLine`; `flags` gains
    `linesUnknown`.
  - `home` is required: the nominal home team at a neutral site.
  - New unsupported reason `'endgame'` for 15 seconds or less left in the game; grading
    skips those plays.
  - `receives2ndHalfKickoff` is replaced by `homeOpeningKickoff`.
  - No change for field goals beyond 70 yards: nfl4th keeps the option with a make
    probability of 0, and the export maps it to null under `maxFieldGoalDistance`.
- **1** (2026-10-21): the interface as first decided.
