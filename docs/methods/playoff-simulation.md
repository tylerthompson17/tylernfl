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
- **Regular season only.** The playoffs themselves are not simulated, so there are no
  chances of winning a round or the Super Bowl.
