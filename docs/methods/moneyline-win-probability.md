# Moneyline to win probability

A delegated method: a standard conversion Tyler asked for, not his own work and not a
model of the site's. It supplies the game probabilities the playoff simulation
(`playoff-simulation.md`) draws from.

Code: `implied` and `betting_lines` in `pipelines/playoff_odds.py`, plugged in as
`GAME_PROBABILITIES`.

## Method

1. nflverse schedules carry each game's American moneylines (`home_moneyline`,
   `away_moneyline`), as published by sportsbooks.
2. Each side's odds become the probability they imply: for odds below zero,
   `-odds / (-odds + 100)`; otherwise `100 / (odds + 100)`. So -150 implies 60.0% and
   +130 implies 43.5%.
3. The two implied probabilities add up to more than 100% (103.4% on average from 2019
   to 2025): the difference is the bookmaker's margin. It is removed by dividing each by
   their sum, so the two sides add up to exactly 1. This is the plain proportional
   method; it has no parameters to tune.
4. A game with no moneyline yet gets 0.5 for each side. See Limitations.

## Validation

Reference: the actual results of every game from 2019 to 2025 that had both moneylines
in nflverse (all 1,960 games played), with a 50/50 guess on every game as the baseline.
The 6 ties are left out, leaving 1,954 decided games, each counted once as the home
team's chance. Reproduce with `docs/methods/scripts/moneyline_calibration.py`.

**Brier score** (mean squared error of the probability; lower is better):

| Forecast | Brier score |
|---|---|
| This conversion | 0.2105 |
| 50/50 on every game | 0.2500 |
| The home team at its average win rate (53.7%) | 0.2486 |

The conversion is 15.8% better than a coin flip. Regular season games alone give the
same 0.2105 (1,865 games).

**Calibration**, predicted home win chance against how often the home team won:

| Predicted | Games | Predicted (mean) | Actual | 95% range from chance |
|---|---|---|---|---|
| 0 to 10% | 3 | 9.4% | 0.0% | ±33.1 |
| 10 to 20% | 49 | 16.1% | 20.4% | ±10.3 |
| 20 to 30% | 159 | 25.4% | 19.5% | ±6.8 |
| 30 to 40% | 265 | 35.2% | 35.1% | ±5.8 |
| 40 to 50% | 285 | 44.6% | 43.5% | ±5.8 |
| 50 to 60% | 341 | 55.6% | 54.0% | ±5.3 |
| 60 to 70% | 369 | 64.6% | 60.4% | ±4.9 |
| 70 to 80% | 331 | 74.9% | 75.8% | ±4.7 |
| 80 to 90% | 135 | 84.5% | 86.7% | ±6.1 |
| 90 to 100% | 13 | 91.5% | 92.3% | ±15.1 |

Every group lands within the range chance alone would give. The largest gaps are 20 to
30% (5.9 points under the prediction) and 60 to 70% (4.2 under). Over all games, home
teams won 1.3 points less often than predicted (55.0% predicted, 53.7% actual), also
within chance for this many games.

**The margin is removed.** Before the conversion, the two sides' implied probabilities
add up to 98.1% to 104.9%, 103.4% on average. After it, they add up to 1 on every game
(largest error 2e-16, rounding). One game's raw odds added up to less than 100%:
2020 week 1, LV at CAR (-124 and +134), which a single sportsbook would not offer, so
it is probably a quirk of the source. The conversion scales it to 1 all the same.

## Limitations

- **Closing lines.** nflverse keeps each game's line as it closed, and that is what was
  validated: the most accurate a line gets. The playoff simulation uses whatever line is
  listed on the day it runs, up to about a week before kickoff, so its accuracy in use
  is likely a little lower than above.
- **Games with no line are a coin flip.** Lines appear about a week ahead, so most of
  the remaining schedule has none, and each such game is 0.5 for both teams: no home
  field (home teams won 53.7% of these games) and no team strength. That is a choice
  of the playoff simulation, not something this validation covers; its note says what
  it does to the odds.
- **Proportional margin removal.** Scaling both sides by the same factor is known to
  overrate longshots slightly compared with other methods (Shin's, the power method).
  This data shows no significant sign of it, so the simpler method stays.
- **One source.** nflverse records one moneyline per side per game; which book it comes
  from, and when it was taken, is up to nflverse.
