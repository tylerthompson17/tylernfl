# Notable performances

A delegated method: a percentile ranking Tyler specified, not his own work and not a
model of the site's. It picks the rows of the home page's notable performances panel.

Code: `pipelines/performance_percentiles.py` writes each category's history to
`src/data/performance_percentiles.json`; `src/lib/performances/notable.ts` ranks the
week's game lines against it at build time.

## Method

1. **Five categories**, each ranked on one stat: passing yards, rushing yards,
   receiving yards, sacks, field goals made. The line shown still names the rest
   ("194 rush yds, 2 TD at GB"), but only the headline stat decides the rank.
2. **The pool.** Every regular season team game from 1999 through the last completed
   season (1999 to 2025 today) gives one value per category: the team's best in that
   stat that game, whoever it was. A team game with no sacks counts as 0. Field goals
   count only team games with at least one attempt. That is 13,912 team games per
   category (12,083 for field goals), from nflverse weekly player stats.
3. **The percentile** of a performance is the share of pool games whose value was
   lower, with games at exactly the same value counted as half. So 2 sacks, which
   77.2% of team leaders fell short of and 17.7% matched exactly, is at 77.2% plus
   half of that tie, 86.1%.
4. **The ranking.** Every line of the week with more than zero in its headline stat is
   placed in its category's pool, each player keeps his best line, and the five highest
   percentiles are shown, with the percentile to one decimal ("Pctl"). Equal percentiles
   go to the category listed first (passing, rushing, receiving, sacks, field goals),
   then to the line's other stats, then to the name.

Measuring against each team's best, not against every player, is what makes the
categories comparable. Against every player with a chance at the stat, most defenders
get no sacks, so a 2-sack game came out at 99.1%, above a 400 yard passing game (98.4%),
and four 2-sack games outranked two 390 yard passers in 2026 week 3.

What familiar lines come to:

| Line | Percentile |
|---|---|
| 300 pass yds | 81.4% |
| 400 pass yds | 98.0% |
| 100 rush yds | 78.0% |
| 150 rush yds | 96.1% |
| 100 rec yds | 69.0% |
| 150 rec yds | 94.7% |
| 2 sacks | 86.1% |
| 3 sacks | 97.8% |
| 4 FG | 95.3% |
| 5 FG | 99.0% |

## Validation

**Against Pro Football Reference.** The pool comes from nflverse; Pro Football
Reference's single-game leader lists (`/leaders/pass_yds_single_game.htm` and the rushing,
receiving, sacks and field goals pages, read 2026-09-29) were checked against it for the
1999 to 2025 regular seasons. The yardage lists show about the top 50 of all time, so
the comparison covers every game above the last value each list shows (a tie at that
value may be cut off); the sacks list shows every 4+ sack game and the field goals list
every 6+ game.

| Games | Pro Football Reference | nflverse | Matched |
|---|---|---|---|
| More than 471 pass yds | 36 | 36 | all 36, game by game |
| More than 221 rush yds | 31 | 31 | all 31, game by game |
| More than 235 rec yds | 25 | 25 | all 25, game by game |
| 4+ sacks | 58 | 58 | same count |
| 6+ field goals made | 35 | 35 | same count |

Game by game means the same player, season and value on both sides. Stathead, which
would give full counts at lower thresholds (400 passing yards, 200 rushing), shows only
a sample of results without a subscription, so those were not compared.

The single-game highs in the data match the recognised marks: 527 passing yards (Matt
Schaub, 2012), 296 rushing yards (Adrian Peterson, 2007), 329 receiving yards (Calvin
Johnson, 2013), 6 sacks (Osi Umenyiora, 2007), 8 field goals (Rob Bironas, 2007).

**Coverage.** nflverse's schedules have 13,934 regular season team games from 1999 to
2025; 22 of them, all in 1999 to 2002, have no player stats at all, so the pool has
13,912 (0.16% missing).

**Sensitivity to the seasons in the pool.** For each of the 18 weeks of 2025, the top
five was found against 1999 to 2024 and against 2019 to 2024 only
(`docs/methods/scripts/notable_sensitivity.py`):

| | Weeks |
|---|---|
| Same first row | 17 of 18 |
| Same five rows | 12 of 18 |
| Same five in the same order | 8 of 18 |
| Rows in common, on average | 4.61 of 5 |

## Limitations

- **Eras drift.** Passing has grown and rushing shrunk since 1999, and the pool mixes
  them: 300 passing yards is 86.1% against 1999 to 2005 and 80.7% against 2019 to 2025;
  100 rushing yards is 73.5% then and 81.6% now. The full pool slightly flatters today's
  passers and undersells today's rushers. The sensitivity check above shows what that
  moves in practice: usually the order within the five, rarely who leads.
- **Rarity is not impact.** Field goals are the most common category in the 2025 top
  fives (26 of the 90 rows, against 12 for passing): 4 made is 95.3%, above a 150 yard
  rushing day, and several field goals often mean drives that stalled short of the end
  zone.
- **One stat per category.** Touchdowns, efficiency and the opponent play no part: a
  400 yard game in a loss with two interceptions ranks like one without.
- **Discrete stats tie.** Sacks come in halves and field goals in ones, so many games
  share a value; the half-of-ties rule places them at the middle of their tie.
- **Five categories only.** Interceptions, tackles, returns and punting are not ranked.
- **The pool stops at the last completed season.** The current season's games are not
  in it until March, so a percentile does not change during a season.
