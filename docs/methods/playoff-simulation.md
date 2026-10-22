# Playoff simulation

A delegated method: a standard Monte Carlo simulation Tyler asked for, not his own work
and not a model of the site's. It writes `src/data/playoff_odds.json` every day, and the
team pages show it, labelled as based on betting lines.

Code: `pipelines/playoff_odds.py`, with the tiebreakers in `pipelines/standings.py`.

## Method

1. Take the season's completed regular season games as they finished.
2. Give every unplayed regular season game a chance of a home win from
   `GAME_PROBABILITIES` (see below).
3. Play out the rest of the season 10,000 times: each game is a home win when a
   uniform random draw falls under its chance, otherwise an away win. Simulated scores
   are 1 to 0, and simulated games never tie.
4. Rank each simulated season with the site's standings code, a literal port of
   nflseedR 2.0.2's `nfl_standings` at its default depth (every NFL tiebreaker through
   strength of schedule, then a coin toss). Where nflseedR draws the coin toss at random,
   the port orders by abbreviation.
5. Count, per team: made the playoffs (seeds 1 to 7), won the division, got the top
   seed, each seed 1 to 7, and average wins. Divide by 10,000.

The random draws are seeded from a hash of the inputs, so a rerun with no new results
and no new lines writes an identical file. Before a season's first game nothing is
simulated and the file is empty.

### Game probabilities

The default is the moneyline conversion (`moneyline-win-probability.md`): each game's
moneylines as nflverse lists them on the day, with the bookmaker's margin removed.

**A game with no betting line yet gets exactly 0.5 for each team.** No home field
advantage and no team strength go into it. Lines appear about a week before a game, so
early in the season nearly every remaining game is 0.5, and even late in the season
only the next week or so is priced. `pricedGames` and `remainingGames` in the file say
how many of each, and the page says the odds are based on betting lines.

What that does to the odds: with most games even, each team's future is close to a
coin flip per game, so the odds lean heavily on the current records and the schedule's
tiebreaker shape. A strong team's chances are understated and a weak team's overstated,
more so the earlier in the season. A team rating model would fix this, and that is
Tyler's: it would replace `GAME_PROBABILITIES`, returning the same thing.

## Validation

Three checks, against nflseedR and against known seasons.

**Tiebreakers against nflseedR.** `pipelines/test_standings.py` checks the port against
nflseedR 2.0.2's own standings after every week from 4 to 18 of 2022, 2023 and 2024
(`tests/fixtures/standings/`, made by `generate.R` there): 43 snapshots, every record,
division rank, conference rank and the tiebreak step that decided each, skipping only
coin tosses. All match. nflseedR cannot resolve two of those weeks (2022 week 13, 2023
week 8); the port falls back to a coin toss there.

**A season whose outcome is known.** `pipelines/test_playoff_odds.py` simulates 2024 from
week 12 with every remaining game given its real result for certain. Every chance comes
out exactly 0 or 1, and the final seeding and wins match what happened.

**The simulator against nflseedR's simulator.** nflseedR 2.0.2's `nfl_simulations` was
run on the same games, with a results function that draws each game from the same
chance the site used (closing moneylines through the conversion above), 10,000 seasons
each, tiebreakers through strength of schedule. Reproduce with
`docs/methods/scripts/playoff_sim_compare.py` and `.R`.

| Checkpoint | Measure | Mean difference | Largest difference |
|---|---|---|---|
| 2023, through week 12 (92 games left) | Playoffs | 0.25 points | 1.6 (HOU 44.8% vs 43.2%) |
| | Division | 0.19 | 0.7 (PHI 85.2% vs 85.9%) |
| | Top seed | 0.13 | 0.9 (JAX 13.8% vs 12.9%) |
| | Average wins | | 0.08 (HOU 9.3 vs 9.22) |
| 2024, through week 9 (134 games left) | Playoffs | 0.29 points | 1.2 (CIN 45.7% vs 46.9%) |
| | Division | 0.21 | 0.9 (PIT 21.2% vs 20.3%) |
| | Top seed | 0.12 | 1.0 (KC 63.9% vs 62.9%) |
| | Average wins | | 0.08 (KC 13.7 vs 13.62) |

These are the size of the random difference between two runs of 10,000: about 0.7
points of standard error on a 50% chance, so a largest gap near 1.5 across 32 teams is
expected. Average wins are rounded to one decimal on the site, which accounts for up to
0.05 of their gap. Nothing points to a difference in method.

## Draft order

The same 10,000 simulated seasons also project round 1 of the next draft, shown on
`/draft/projected/` and labelled as based on betting lines. Tyler asked for it as part of
the draft section; the order's rules are in `draft-order.md`.

1. Seed each simulated season as above (the standings the playoff odds count).
2. Play its playoffs: seeds 2 to 7 in the wild card round (2 hosts 7, 3 hosts 6, 4 hosts
   5), the top seed hosting the lowest seed left in the divisional round, the higher
   seed hosting after that, and the Super Bowl at a neutral site. A playoff game already
   played keeps its result. Every other one is a home win with the chance
   `GAME_PROBABILITIES` gives it, which is **0.5 for a game with no betting line: every
   playoff game until the real matchups are set in January.** `pricedPlayoffGames` in
   the file says how many have a line, and the page says playoff games are even.
3. Set that season's draft order by `draft_order.order`: its own final records,
   strength of schedule and tiebreakers, with any tie still level at the end drawn at
   random within that season (a fresh random key per team per season, used by every
   coin toss in it).
4. Apply the picks file, then count each team's pick. Per team: expected wins (the
   playoff odds' average), mean and median pick, the chance of pick 1, top 3, top 5
   and top 10, a likely range (10th to 90th percentile pick), and each pick's chance.
   For a pick that goes to whichever of two slots comes first, how often each one goes.

The draft's draws (playoff games, coin tosses) come from a second random stream seeded
from the playoff odds' seed. The odds draw exactly what they drew before, so
`playoff_odds.json` is byte-identical with or without the projection:
`test_playoff_odds.py` compares the output with and without it against a file saved
before the projection existed (`tests/fixtures/playoff_odds/2023_week10.json`).

### Validation

**A finished season.** With all of 2025 played, every simulated season is 2025, and
every team's chance of its real 2026 pick comes out exactly 1.

**The bracket.** With 2025's regular season played and every playoff game even, a team
leaves each round half the time: 10,000 seasons gave each wild card team 0.496 to 0.505
out in the wild card round (exact: 0.5), 0.246 to 0.253 out in the divisional round
(0.25), 0.119 to 0.132 in the conference round (0.125), and 0.059 to 0.066 each for
losing and winning the Super Bowl (0.0625). Top seeds were never out in the wild card
round, and won it all 0.131 (DEN) and 0.119 (SEA) of the time (0.125). Played playoff
games stay as they finished (tested from the wild card round on).

**Coin tosses are drawn.** After 2025's week 1 alone, 16 teams are level on
everything; each takes pick 1 about one time in 16.

**Against nflseedR.** nflseedR 2.0.2's `nfl_simulations` with `sim_include = "DRAFT"`
plays out the playoffs and sets a draft rank in every simulated season. Run on the same
two checkpoints as above, with the same chances for regular season games and every
playoff game even on both sides, 10,000 seasons each. Reproduce with
`docs/methods/scripts/draft_sim_compare.py` and `.R` (after `playoff_sim_compare.py
prepare`).

| Checkpoint | Measure | Mean difference | Largest difference |
|---|---|---|---|
| 2023, through week 12 | Mean pick | 0.06 picks | 0.22 (GB 17.8 vs 17.58) |
| | Pick 1 | 0.07 points | 1.0 (CAR 55.3% vs 56.3%) |
| | Top 3 | 0.15 | 1.8 (NE 72.4% vs 74.2%) |
| | Top 5 | 0.19 | 1.2 (TEN 14.3% vs 15.5%) |
| | Top 10 | 0.34 | 1.7 (LV 48.2% vs 46.5%) |
| 2024, through week 9 | Mean pick | 0.05 picks | 0.15 (PIT 22.7 vs 22.55) |
| | Pick 1 | 0.13 points | 1.1 (CAR 21.6% vs 20.5%) |
| | Top 3 | 0.19 | 1.2 (CAR 52.6% vs 51.4%) |
| | Top 5 | 0.22 | 1.2 (CAR 74.6% vs 73.4%) |
| | Top 10 | 0.18 | 0.9 (TEN 79.1% vs 78.2%) |

The largest gaps are 2.5 to 3 standard errors of the difference between two runs of
10,000, the top of what 32 teams by five measures would give by chance. The site's mean
pick is rounded to one decimal, up to 0.05 of its gap. One small difference in method
remains: between conferences the site goes on to head-to-head, common games and strength
of victory before a coin toss, and nflseedR at this depth may toss sooner; it decides a
few simulated places at most.

## Limitations

- **Games with no line are even.** See Game probabilities. This is the largest
  limitation by far.
- **Chances are fixed within a simulated season.** A team that wins its first three
  simulated games is no likelier to win the fourth. nflseedR's default simulation
  updates an Elo rating as it goes, which spreads the outcomes wider; this one does
  not, so extreme outcomes are somewhat rarer here.
- **Lines as published on the day.** A line taken days before kickoff misses later news.
- **No ties.** About 0.3% of real games tie; a simulated game never does.
- **Coin tosses by abbreviation.** Where the tiebreakers run out, the team whose
  abbreviation comes first wins, every time, rather than half the time. It decides very
  few simulated seedings.
- **Playoffs only for the draft.** The playoffs are simulated for the projected draft
  order, every game even until real lines exist, so they say nothing about who is
  better: the site shows no chances of winning a round or the Super Bowl. A bye is
  worth exactly one round, and picks 19 to 32 within a playoff team's range are close
  to a coin flip per game.
- **Projected draft coin tosses stop early.** The league's steps after strength of
  victory (points) are not applied, so ties there are drawn at random, more often than
  the league would need a toss.
