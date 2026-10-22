# Team ratings

A delegated method: a standard rating fit Tyler asked for, not his own work and not a
model of the game. The ratings only restate what the betting market has said about each
team this season, so that games without a line yet can be priced the way the market
prices the games that have one. They feed the playoff simulation
(`playoff-simulation.md`) and, through it, the draft projection.

Code: `pipelines/team_ratings.py`, plugged in through `GAME_PROBABILITIES`
(`lines_and_ratings` in `pipelines/playoff_odds.py`). Tuning and validation:
`docs/methods/scripts/team_ratings_backtest.py`, run by hand.

## Method

1. **Data.** This season's nflverse schedule: every game with both moneylines, played
   (its closing line) or still to play (the line listed on the day). Each line becomes
   the home team's chance with the margin removed, by the existing conversion
   (`betting_lines`, `moneyline-win-probability.md`).
2. **Model.** On the logit scale,
   `logit(P(home wins)) = r_home - r_away + h * (not at a neutral site)`,
   one rating `r` per team and one home field `h`. International games and the Super
   Bowl are neutral (`location` in the schedule).
3. **Fit.** Weighted ridge least squares on the logit of each line, in closed form
   (numpy, one 33 by 33 solve). The penalty applies to the ratings only, pulling them
   toward last season's final ratings times a carryover `c`; `h` is not penalized. The
   ratings sum to zero: every game adds to one rating what it takes from the other, so
   the data never move the sum, and with the penalty's target centred the solution sums
   to zero exactly.
4. **Recency.** A game's weight halves every `half-life` weeks before the latest final
   of the season. Lines for games still to play weigh 1. Ages count from that latest
   final rather than the clock, so a rerun with the same inputs gives the same ratings.
5. **Last season.** The same fit over all of last season's priced games, playoffs
   included, as of its last game, pulled toward zero. Relocated franchises carry over by
   today's abbreviation (STL to LAR, SD to LAC, OAK to LV).
6. **Pricing.** A game with its own moneylines keeps them. Every other game, playoffs
   included, is priced from the ratings, with no home field at a neutral site.
7. **Uncertainty.** In each simulated season, each team's rating is drawn once from
   N(estimate, sigma²) and that draw prices all of its rated games that season, regular
   season and playoffs. A team drawn stronger is stronger in every game, so its win total
   spreads the way real ones do (see Validation). Games with a line are not redrawn.

The constants: `c = 0.7`, half-life 3 weeks, penalty 1.0, sigma 0.6 (logit units per
team). On 2026-10-22 home field came out at 0.226 (about 5.6 points of win chance at
even ratings).

### What changed in the simulator

The simulator's loop is the same; one hook was added. `GAME_PROBABILITIES` is now
given the schedule and season and returns the pricing function, and when that function
has `draw(rng)`, `simulate` calls it once per simulated season, from its own random
stream, and passes the result to the draft projection so the playoff games use the same
draw. With a fixed pricing function (`betting_lines`), the output is byte-identical to
before (`test_playoff_odds.py`, against the file saved before the draft projection).

## Validation

Reference: every regular season from 2015 to 2025 (11 seasons), nflverse closing lines
and results. For each season and cutoff week w (1, 2, 4, 6, 8, 10, 12 and 14), the
ratings are fitted the way the daily run fits them: every game through week w with its
closing line, plus week w + 1's lines (out before its games), with ages counted from the
last game of week w. They then price the rest of the regular season. Week w + 1 is
priced from its lines in every setup; "far games" are weeks w + 2 on, where the setups
differ. Log loss is on the real results, ties left out (lower is better; 50/50 is
0.6931). The daily run on a Thursday often has two weeks of lines, so in use slightly
fewer games depend on the ratings than here.

### Tuning

Grid: carryover 0.4, 0.55, 0.7, 0.85, 1.0; half-life 1.5, 2, 3, 4.5, 6, 10 weeks and no
decay; penalty 0.1, 0.3, 1, 3. **140 points** for the fit, chosen on the far games' log
loss; then **sigma over 10 values** (0 to 1.0) at the chosen fit, chosen on win totals
below. 150 settings in all.

Best: carryover 0.7, half-life 3 weeks, penalty 1.0, far-game log loss 0.6460. The
surface is flat near the best: carryover anywhere from 0.55 to 0.85 is within 0.0001,
half-life 2 to 4.5 weeks within 0.0002; no decay costs 0.0013, penalty 3 costs 0.0037.

Leaving each season out in turn (tuning on the other ten, scoring the one left), 6 of
11 seasons choose the same setting, and the pooled held-out log loss is 0.6471 against
0.6460 in sample: the tuning flatters the results by about 0.001.

### Log loss on the rest of the season

| After week | Games | 50/50 | Current (lines, else 50/50) | Lines, else ratings | All closing lines |
|---|---|---|---|---|---|
| 1 | 2,713 | 0.6931 | 0.6887 | **0.6521** | 0.6110 |
| 2 | 2,538 | 0.6931 | 0.6912 | **0.6533** | 0.6100 |
| 4 | 2,193 | 0.6931 | 0.6908 | **0.6469** | 0.6041 |
| 6 | 1,875 | 0.6931 | 0.6845 | **0.6390** | 0.5967 |
| 8 | 1,563 | 0.6931 | 0.6879 | **0.6441** | 0.6016 |
| 10 | 1,261 | 0.6931 | 0.6784 | **0.6299** | 0.5847 |
| 12 | 939 | 0.6931 | 0.6787 | **0.6317** | 0.5916 |
| 14 | 607 | 0.6931 | 0.6582 | **0.6211** | 0.5790 |
| All | 13,689 | 0.6931 | 0.6858 | **0.6440** | 0.6015 |

The last column is out of reach: it prices every future game with the line set the
week of that game, knowing everything the market learned in between. It shows how much
is left: the ratings close about half of the gap between the current setup and it
(0.0418 of 0.0843 over all games). On far games alone the ratings score 0.6540 after
week 1 and 0.6360 to 0.6457 from week 4 on, against 0.6931 for 50/50.

### Calibration

Far games, every season and cutoff pooled, priced with sigma 0.6 (the chance averaged
over the rating draws). A game counts once for each cutoff before it, so neighbouring
rows are not independent and the 95% range below understates the real one.

| Predicted | Games | Predicted (mean) | Actual | 95% range from chance | Closing line (mean) |
|---|---|---|---|---|---|
| 10 to 20% | 10 | 19.3% | 0.0% | ±24.5 | 16.8% |
| 20 to 30% | 224 | 26.7% | 29.9% | ±5.8 | 21.9% |
| 30 to 40% | 1,126 | 36.1% | 30.7% | ±2.8 | 33.5% |
| 40 to 50% | 2,744 | 45.5% | 43.0% | ±1.9 | 43.7% |
| 50 to 60% | 3,676 | 55.1% | 55.1% | ±1.6 | 55.6% |
| 60 to 70% | 3,147 | 64.6% | 66.6% | ±1.7 | 65.3% |
| 70 to 80% | 1,276 | 73.8% | 76.4% | ±2.4 | 75.0% |
| 80 to 90% | 168 | 82.3% | 88.1% | ±5.8 | 83.3% |
| 90 to 100% | 5 | 91.2% | 0.0% | ±24.8 | 89.0% |

Overall the home team was predicted to win 55.4% and won 55.2%. The rated chances are
a little too cautious one game at a time: outside 50 to 60%, actual results sit further
from 50% than predicted, by 2 to 6 points. That is the price of sigma (below). At sigma 0 the
same games are slightly less cautious and score 0.6460 instead of 0.6468: one game's
chance hardly depends on sigma, so sigma was not set on single games.

### Sigma: win totals

What sigma changes is how a team's games move together, which is what decides playoff
places. For every team, season and cutoff (2,816 cases), the far games' actual wins
(ties as half) are compared with the mean and variance the rating draws predict. If the
spread is right, the squared miss over the predicted variance averages 1.

| Sigma | 0 | 0.2 | 0.4 | 0.5 | **0.6** | 0.7 | 0.8 | 1.0 |
|---|---|---|---|---|---|---|---|---|
| Ratio | 1.536 | 1.423 | 1.200 | 1.093 | **1.001** | 0.922 | 0.857 | 0.759 |

Without the draws, real win totals miss by more than predicted: squared misses half again
as large as the predicted variance. By cutoff,
sigma 0.6 is closest to 1 in every group: 1.001 after weeks 1 and 2, 1.005 after 4 and
6, 1.015 after 8 and 10, 0.981 after 12 and 14. The share of actual totals inside the
predicted middle 80% rises from 63 to 74% at sigma 0 to 76 to 79% at sigma 0.6. As a
check on the measure, the closing lines of the same games, with no draws, give 1.044:
the excess is how much the market itself re-prices teams over the rest of a season
(injuries, quarterback changes), which the ratings cannot know at the cutoff.

### Against next week's closing lines

Fitted through week w without week w + 1's lines, the ratings' price for each week w + 1
game against its closing line (no-vig), 2015 to 2025:

| After week | Games | Mean gap in win chance | RMSE, logit | Within 5 points | 50/50's mean gap |
|---|---|---|---|---|---|
| 1 | 176 | 8.6 | 0.479 | 36% | 15.3 |
| 2 | 176 | 7.4 | 0.436 | 41% | 15.0 |
| 4 | 160 | 7.2 | 0.414 | 46% | 15.3 |
| 6 | 156 | 7.1 | 0.424 | 41% | 14.7 |
| 8 | 150 | 7.8 | 0.448 | 41% | 15.7 |
| 10 | 155 | 6.9 | 0.408 | 46% | 16.0 |
| 12 | 168 | 7.7 | 0.435 | 36% | 16.6 |
| 14 | 176 | 7.4 | 0.456 | 41% | 17.7 |

Over all 1,317 games: mean gap 7.5 points, median 6.3, 90th percentile 15.4. Half the
gap of a coin flip, and a week out. The gap does not shrink as the season goes on,
because the half-life keeps only the last few weeks in play: the market moves with
news, and the ratings follow it a week late.

Home field, after week 8: 0.356 (2015), 0.284, 0.307, 0.260, 0.287, 0.191 (2020, no
crowds), 0.262, 0.203, 0.225, 0.222, 0.217 (2025). It is fitted every day, not fixed.

## On 2026-10-22

The daily run's projection rerun with the ratings, against the same schedule priced the
old way (lines for weeks 7 and 8, 50/50 for weeks 9 to 18), 10,000 simulations each:

| Team | Record | Rating | Playoffs | Mean wins | Median pick | Pick 1 |
|---|---|---|---|---|---|---|
| LAC | 0-6 | -0.18 | 1.4% to 1.8% | 5.2 to 4.9 | 3 to 5 | 26.1% to 15.3% |
| MIA | 0-5 | -0.91 | 2.8% to 0.4% | 5.5 to 3.4 | 5 to 2 | 16.8% to 35.3% |
| TEN | 1-5 | -0.84 | 6.5% to 1.4% | 6.1 to 4.4 | 5 to 3 | 14.5% to 23.5% |
| TB | 1-5 | -0.24 | 13.2% to 11.2% | 6.4 to 5.8 | 6 to 7 | 10.1% to 6.1% |

The market rates the Chargers as a middling team, so they are expected to win more of
what is left than Miami or Tennessee, and drop behind them for the first pick.

## Limitations

- **The market, a week late.** The ratings know only what the lines said. News that
  the market has not priced yet, or prices only in a game's own line, reaches them a
  week later, and the 3 week half-life means a team's last few lines carry most of its
  rating.
- **Cautious single games.** Sigma 0.6 is set for win totals. One game at a time it
  pulls chances toward 50% a little more than results support (Calibration).
- **One sigma for everyone.** Every team gets the same uncertainty, whether its rating
  rests on a stable roster or on a backup quarterback, and it does not shrink as the
  season goes on (the backtest found no reason to: 0.6 was best at every cutoff).
- **Fixed within a simulated season.** A drawn rating stays put through that season;
  it does not drift week to week as real teams do. Drawing once per season is what the
  win total check calibrates.
- **Playoff games are not validated separately.** The backtest scores regular season
  games. Playoff matchups are priced by the same ratings and home field, and the Super
  Bowl as neutral, which assumes playoff games behave like regular season ones.
- **Home field is one number.** No team-specific home field, no travel or rest.
- **Early season.** Before week 2 the ratings are mostly last season's, times 0.7, plus
  one or two weeks of lines. The backtest's after-week-1 row is how well that does.
- **The tuning saw the test seasons.** The leave-one-season-out check puts the optimism
  at about 0.001 of log loss.
