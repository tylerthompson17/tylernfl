# Draft order

Not a model: the league's rules for the order of the draft, applied to today's records.
`pipelines/draft_order.py` writes `src/data/draft_order.json` every day, round 1 of the
draft that follows the current season, as it would stand if the season ended today.
The projected order (simulated seasons) is a delegated method, in the Draft order
section of `playoff-simulation.md`; it uses these same rules on each simulated season.

Rules as published: [NFL tie-breaking procedures, selection meeting](https://www.nfl.com/standings/tie-breaking-procedures).

## The order

1. Teams that missed the playoffs pick 1 to 18, then wild card losers 19 to 24,
   divisional losers 25 to 28, conference championship losers 29 and 30, the Super
   Bowl loser 31 and the champion 32.
2. Within each group, the lower win percentage picks first. A tie counts as half a win.
3. Teams on the same win percentage: the lower strength of schedule picks first.
   Strength of schedule is the standings' (`pipelines/standings.py`): opponents' combined
   win percentage over every game played, an opponent played twice counting twice.
4. Teams still level:
   - Of one division: the division tiebreakers, reversed (the team that would lose them
     picks first).
   - Of one conference: the conference tiebreakers, reversed.
   - Of both conferences: the team that would pick first in each conference by the two
     steps above, then between those two: head-to-head, record in common games (at least
     four), strength of victory, the lower picking first in each.
   - Once one team is placed, the rest start again from the top of this step.

The division and conference tiebreakers are the standings', a port of nflseedR 2.0.2
checked against nflseedR (`pipelines/test_standings.py`). `standings.rank_tied` ranks
exactly the teams still level, and is checked to give the standings' order whenever it
is given the teams the standings found level on a record.

## If the season ended today

During the regular season, today's standings decide who is a playoff team (seeds 1 to
7 of each conference). No playoff game has been played, so the 14 playoff teams are one
group, ordered by record and the same tiebreakers as everyone else. That is not how
picks 19 to 32 will be set: they follow the round each team goes out in, and the page
says so. During the playoffs, teams already out go by their round, and teams still
alive go after all of them, ordered among themselves by record.

## Coin tosses

The league's steps after strength of victory read points: combined ranking in points
scored and allowed, net points, net touchdowns. The standings port stops before points
at every level (as nflseedR does at its default depth), so a tie still level after
strength of victory goes straight to a coin toss here. In the current order such a tie
is shown as a coin flip still to come, in abbreviation order. Early in a season this is
common: after week 1, every team is level with 15 others on everything.

The league's real coin tosses (held before the draft) are not recorded anywhere this
pipeline reads, so a tie settled that way stays marked as a coin flip in the final
order. It has not happened in a validation season yet.

## Pick ownership

`pipelines/inputs/round1_picks.json`, kept by hand: each traded or forfeited round 1 pick
with a team or league source. A forfeited pick is removed and later picks move up. A
`choice` is a pick that goes to whichever of two slots comes first (or last): the Jets
hold the earlier of Dallas's and Green Bay's 2027 picks, so their owner is settled only
once the order is known.

nflverse's trade data (`load_trades`) is not used for ownership. Checked on 2026-10-22,
it had no trade after 2026-04-17, no original team for a pick that moved twice, a
conditional flag without the condition, and no forfeitures. The daily run compares it
with the file and logs a warning for any round 1 trade the file lacks, without failing.

## Validation

Reference: the league's round 1 order for the 2026 draft, by original team, as NFL.com
published it before the draft (`tests/fixtures/draft/2026_round1.json`, source in the
file).

`pipelines/test_draft_order.py` runs the 2025 regular season and playoffs
(`tests/fixtures/draft/games_2025.csv`, nflverse) through the rules. **All 32 picks
match**, and with the seven traded 2026 picks NFL.com lists, so does every owner.

What 2025 exercises: strength of schedule settled every tie, including four teams at
3-14 across both conferences (LV, NYJ, ARI, TEN, picks 1 to 4), two at 5-12, three at
6-11, four at 8-9, two at 9-8, two at 11-6 among wild card losers and three at 12-5 among
divisional losers. Carolina, a division winner at 8-9, picked 19th, after every team
that missed the playoffs. The steps after strength of schedule were not needed in
2025, so they are tested on small made-up seasons instead: head-to-head within a
division and across conferences, common games with and without four, strength of
victory, three teams across conferences starting again after each pick, and the coin
toss.

## Limitations

- Points steps are not applied (see Coin tosses).
- Until the playoffs, picks 19 to 32 are a placeholder ordered by record.
- Ownership is only as current as the hand-kept file. A trade not yet entered shows the
  pick with its original team.
