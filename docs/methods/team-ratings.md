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
7. **Uncertainty.** In each simulated season, each team's rating is drawn once, with
   spread sigma, and that draw prices all of its rated games that season, regular season
   and playoffs. A team drawn stronger is stronger in every game, so its win total
   spreads the way real ones do (see Validation). Games with a line are not redrawn.
8. **Stretch.** Averaging a logistic over normal draws pulls every chance toward 50/50
   (the logistic-normal effect). So before the draws are added, the whole logit
   (rating difference and home field) is multiplied by `sqrt(1 + pi * 2 sigma^2 / 8)`,
   1.154 at sigma 0.65, and the draws are centred on that: a team's drawn rating is
   N(1.154 r, sigma^2). A game's chance averaged over the draws then matches its point
   estimate: on the backtest's games the gap averages 0.2 points of win chance, at most
   0.35 (`stretch` in the code, tested in `test_team_ratings.py`).

The constants: `c = 0.55`, half-life 2 weeks, penalty 1.0, sigma 0.65 (logit units per
team). On 2026-10-22 home field came out at 0.228 (about 5.7 points of win chance at
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
ratings are fitted the way the daily run fits them midweek: every game through week w
with its closing line, plus the lines of weeks w + 1 and w + 2, with ages counted from
the last game of week w. **No line from week w + 3 on is seen at a cutoff**, and last
season's final ratings use only last season. They then price the rest of the regular
season. Weeks w + 1 and w + 2 are priced from their lines in every setup; "far games"
are weeks w + 3 on, where the setups differ. Log loss is on the real results, ties left
out (lower is better; 50/50 is 0.6931).

Closing lines stand in for the lines of weeks w + 1 and w + 2 as listed midweek, which
can still move before kickoff; that flatters every setup equally, since they all use
them. On a Monday the daily run often has only week w + 1's lines.

### Tuning

Grid: carryover 0.4, 0.55, 0.7, 0.85, 1.0; half-life 1, 1.5, 2, 3, 4.5, 6, 10 weeks and
no decay; penalty 0.1, 0.3, 1, 3. **160 points** for the fit, chosen on the far games'
log loss; then **sigma over 10 values** (0 to 1.2) at the chosen fit, chosen on win
totals below. 170 settings in all.

Best: carryover 0.55, half-life 2 weeks, penalty 1.0, far-game log loss 0.6453. The
half-life sits inside the grid, with values on both sides:

| Half-life (weeks) | 1 | 1.5 | **2** | 3 | 4.5 | 6 | 10 | No decay |
|---|---|---|---|---|---|---|---|---|
| Far-game log loss | 0.6459 | 0.6455 | **0.6453** | 0.6454 | 0.6456 | 0.6458 | 0.6462 | 0.6468 |

The surface is flat near the best: carryover 0.4 to 0.7 all give 0.6453 (1.0 gives
0.6455). Penalty 0.3 costs 0.0004 and penalty 3 costs 0.0042.

Leaving each season out in turn (tuning on the other ten, scoring the one left), 5 of
11 seasons choose the same setting and the rest choose nearby ones. The pooled held-out
log loss is 0.6468 against 0.6453 in sample: the tuning flatters the results by about
0.0015.

### Log loss on the rest of the season

| After week | Games | 50/50 | Current (lines, else 50/50) | Lines, else ratings | All closing lines |
|---|---|---|---|---|---|
| 1 | 2,713 | 0.6931 | 0.6869 | **0.6518** | 0.6110 |
| 2 | 2,538 | 0.6931 | 0.6869 | **0.6505** | 0.6100 |
| 4 | 2,193 | 0.6931 | 0.6866 | **0.6445** | 0.6041 |
| 6 | 1,875 | 0.6931 | 0.6730 | **0.6342** | 0.5967 |
| 8 | 1,563 | 0.6931 | 0.6890 | **0.6428** | 0.6016 |
| 10 | 1,261 | 0.6931 | 0.6604 | **0.6193** | 0.5847 |
| 12 | 939 | 0.6931 | 0.6653 | **0.6270** | 0.5916 |
| 14 | 607 | 0.6931 | 0.6319 | **0.6076** | 0.5790 |
| All | 13,689 | 0.6931 | 0.6788 | **0.6403** | 0.6015 |

The last column is out of reach: it prices every future game with the line set the
week of that game, knowing everything the market learned in between. The ratings close
half of the gap between the current setup and it (0.0385 of 0.0773). On far games alone
they score 0.6528 after week 1 and 0.6338 to 0.6465 from week 4 on, against 0.6931 for
50/50.

### Calibration of single games

Far games, every season and cutoff pooled, priced as the simulator prices them (sigma
0.65 with the stretch, averaged over the draws). A game appears once for each cutoff
before it, so each appearance is weighted by one over its number of appearances: every
game counts once, and the 95% range uses that count (2,363 games).

| Predicted | Games | Predicted (mean) | Actual | 95% range from chance | Closing line (mean) |
|---|---|---|---|---|---|
| 10 to 20% | 5 | 17.9% | 11.7% | ±34.5 | 19.9% |
| 20 to 30% | 59 | 26.4% | 24.2% | ±11.3 | 23.1% |
| 30 to 40% | 215 | 35.9% | 31.1% | ±6.4 | 33.8% |
| 40 to 50% | 488 | 45.4% | 42.1% | ±4.4 | 43.4% |
| 50 to 60% | 637 | 55.1% | 54.3% | ±3.9 | 54.9% |
| 60 to 70% | 603 | 64.8% | 65.7% | ±3.8 | 64.4% |
| 70 to 80% | 299 | 74.1% | 71.9% | ±5.0 | 73.7% |
| 80 to 90% | 57 | 83.0% | 89.4% | ±9.7 | 82.5% |
| 90 to 100% | 1 | 92.2% | 22.2% | ±49.6 | 89.2% |

Every group with more than one game lands within its range. A logistic regression of the
results on the predicted logit, with seasons resampled 1,000 times for the ranges:

| | Intercept (0 if calibrated) | Slope (1 if calibrated) |
|---|---|---|
| Ratings | -0.088 (95%: -0.173 to -0.014) | 1.129 (0.992 to 1.276) |
| Closing lines, same games | -0.033 | 1.071 |

The slope is consistent with 1. **The intercept is not consistent with 0**: the ratings
favour home teams slightly. They predicted the home team to win 56.1% of these games;
home teams won 54.8%, and the closing lines on the same games said 55.2%. So about 0.9
points of the 1.3 point gap is the ratings' home field running higher than the later
lines, and the rest is the market's own. The fitted home field drifts down during the
season (0.29 on average after week 1, 0.25 after week 14), and in some seasons the
late-season lines carry less home field than the first half's (2019 to 2021); the
ratings carry today's home field to every later game. The method has no correction for
it (see Limitations).

### Sigma: win totals

What sigma changes is how a team's games move together, which is what decides playoff
places. For every team, season and cutoff (2,816 cases), the far games' actual wins
(ties as half) are compared with the mean and variance the rating draws predict, with
the stretch applied. If the spread is right, the squared miss over the predicted
variance averages 1.

| Sigma | 0 | 0.2 | 0.4 | 0.5 | 0.6 | **0.65** | 0.7 | 0.8 | 1.0 | 1.2 |
|---|---|---|---|---|---|---|---|---|---|---|
| Ratio | 1.476 | 1.381 | 1.191 | 1.099 | 1.018 | **0.983** | 0.950 | 0.892 | 0.804 | 0.742 |

Without the draws, squared misses of real win totals are half again as large as the
predicted variance. Sigma 0.65 gives 0.972 after weeks 1 and 2, 0.983 after 4 and 6,
0.980 after 8 and 10, and 0.996 after 12 and 14. The share of actual totals inside the
predicted middle 80% rises from 62 to 77% at sigma 0 to 78 to 80% at sigma 0.65. As a
check on the measure, the closing lines of the same games, with no draws, give 1.028:
the excess is how much the market itself re-prices teams over the rest of a season
(injuries, quarterback changes), which the ratings cannot know at the cutoff.

With the stretch, sigma no longer moves single games: their log loss is 0.6453 at sigma
0 and 0.6454 at 0.65. So the two calibrations are separate. The point estimates set
single games, and sigma sets win totals.

### Against next week's closing lines

Fitted through week w without week w + 1's lines, the ratings' price for each week w + 1
game against its closing line (no-vig), 2015 to 2025:

| After week | Games | Mean gap in win chance | RMSE, logit | Within 5 points | 50/50's mean gap |
|---|---|---|---|---|---|
| 1 | 176 | 10.2 | 0.558 | 27% | 15.3 |
| 2 | 176 | 7.8 | 0.465 | 36% | 15.0 |
| 4 | 160 | 7.3 | 0.420 | 43% | 15.3 |
| 6 | 156 | 7.3 | 0.432 | 43% | 14.7 |
| 8 | 150 | 7.9 | 0.459 | 37% | 15.7 |
| 10 | 155 | 7.2 | 0.416 | 44% | 16.0 |
| 12 | 168 | 8.0 | 0.445 | 33% | 16.6 |
| 14 | 176 | 7.8 | 0.472 | 34% | 17.7 |

Over all 1,317 games: mean gap 8.0 points, median 6.7, 90th percentile 16.3, about half
a coin flip's. After week 1 the gap is largest, since a 2 week half-life leaves the
ratings resting on one week of lines and last season's ratings. The short half-life
was chosen on results further out, and it gives up a little here: the first tuning
(3 weeks, carryover 0.7) was 0.5 points closer to next week's lines.

Home field, after week 8: 0.361 (2015), 0.300, 0.303, 0.285, 0.272, 0.180 (2020, no
crowds), 0.266, 0.213, 0.245, 0.183, 0.199 (2025). It is fitted every day, not fixed.

## On 2026-10-22

The daily run's projection rerun with the ratings, against the same schedule priced the
old way (lines for weeks 7 and 8, 50/50 for weeks 9 to 18), 10,000 simulations each:

| Team | Record | Rating | Playoffs | Mean wins | Median pick | Pick 1 |
|---|---|---|---|---|---|---|
| LAC | 0-6 | -0.25 | 1.4% to 1.7% | 5.3 to 4.7 | 3 to 4 | 25.0% to 17.1% |
| MIA | 0-5 | -0.86 | 3.1% to 0.5% | 5.6 to 3.4 | 5 to 2 | 17.0% to 35.4% |
| TEN | 1-5 | -0.78 | 7.3% to 1.3% | 6.1 to 4.3 | 5 to 3 | 14.4% to 22.8% |
| TB | 1-5 | -0.25 | 13.3% to 10.4% | 6.4 to 5.7 | 6 to 6 | 9.9% to 6.4% |

The market rates the Chargers as a middling team, so they are expected to win more of
what is left than Miami or Tennessee, and drop behind them for the first pick.

## Limitations

- **Home teams slightly favoured.** The ratings over-predict home teams by about 1.3
  points of win chance on games three or more weeks out (Calibration), mostly because
  home field drifts down during a season and the ratings carry today's forward. Not
  corrected.
- **The market, a week late.** The ratings know only what the lines said. News that
  the market has not priced yet, or prices only in a game's own line, reaches them a
  week later, and the 2 week half-life means a team's last few lines carry most of its
  rating.
- **One sigma for everyone.** Every team gets the same uncertainty, whether its rating
  rests on a stable roster or on a backup quarterback, and it does not shrink as the
  season goes on (the backtest found little reason to: 0.6 to 0.65 was best at every
  cutoff).
- **The stretch is an approximation.** It uses the logistic-normal approximation, so the
  averaged chance matches the point estimate to within 0.35 points rather than exactly.
- **Fixed within a simulated season.** A drawn rating stays put through that season;
  it does not drift week to week as real teams do. Drawing once per season is what the
  win total check calibrates.
- **Playoff games are not validated separately.** The backtest scores regular season
  games. Playoff matchups are priced by the same ratings and home field, and the Super
  Bowl as neutral, which assumes playoff games behave like regular season ones.
- **Home field is one number.** No team-specific home field, no travel or rest.
- **Early season.** Before week 2 the ratings are mostly last season's, times 0.55,
  plus a couple of weeks of lines. The backtest's after-week-1 row is how well that does.
- **The tuning saw the test seasons.** The leave-one-season-out check puts the optimism
  at about 0.0015 of log loss.
