# 4th down and try decisions: grading against nfl4th

`pipelines/decisions.py` writes `src/data/decisions.json` every morning: every 4th down
and every try after a touchdown of the season's final games, each option's win
probability, nfl4th's call, what the team did, and whether the choice is graded. The
call is shown as "nfl4th's recommendation". It is Ben Baldwin's model, reproduced
(`docs/methods/fourth-down-model.md`), not this site's.

## How it runs

- Plays come from nflverse play-by-play through `pbp_cache.py`, for every game final in
  the schedule and present in the play-by-play (regular season and playoffs).
- Each situation is built from nflverse's columns the way the fourth-down repo's export
  builds its fixtures (`situations_from_pbp`): clock, score, timeouts, opening kickoff,
  roof, spread and total as nflverse publishes them.
- Every situation goes through the site's own engine (`src/lib/fourth-down.ts`) in one
  Node process per run (`pipelines/engine_batch.ts`, called by `engine.py`), so the grades
  and the calculator cannot disagree. About 1,800 situations take 25 seconds.

## What is graded

The rules are the contract's (`docs/model-interface.md`, section 3) and Tyler's
decisions of 2026-10-22:

- A choice is graded when it differs from nfl4th's call by at least 2 points of win
  probability (`threshold`). Its cost (`wpCost`) is the call's WP minus the choice's, at
  the snap, whatever happened next. Every play carries its cost; agreeing is 0.
- Fakes (a pass or run from punt or field goal formation) count as going for it.
- Not graded: overtime and 15 seconds or less left (nfl4th computes neither), kneels and
  spikes, plays nullified by a post-snap penalty, a choice the model leaves out, and games
  already decided (every option under 2% or every one over 98%).
- Pre-snap penalties are not decisions. A pre-snap foul is a no-play whose text describes
  no play before the penalty ("X reported in as eligible" does not count as a play).
- A delay of game by the offense followed by a punt or field goal is graded at the spot
  before the delay, since backing up is part of the kick. Followed by anything else, the
  snap is graded. Either way the delay is recorded with how far it moved the ball.
- A timeout right before the snap is recorded with who called it. nflverse's timeouts
  remaining on the snap's row already count it (checked: "Timeout #2 by LAC", then LAC
  with 1 left on the snap).
- A try retaken after a penalty keeps the last attempt.
- Every run recomputes the whole season, so a model change reaches every play the next
  morning. The file and the pages name the model version and the data date.

## Coaches

Each decision is credited to its team's head coach in that game (nflverse's `home_coach`
and `away_coach`), so an interim coach is ranked for his own games. The leaderboard counts
every evaluated decision (supported, not in a decided game, a choice the model has a
number for), 4th downs and tries together, and sums the cost of the mistakes, the ones
costing 2 points of win probability or more. It is sorted by that total, shown with the
number of decisions and the average per decision so a small sample shows. Totals are
ranked on their displayed value (one decimal place of a point), so equal totals share a
rank.

## The page's intro

`summary` in decisions.json holds the numbers the page quotes, so none is typed by hand.
Through week 6:

- nfl4th says go on 41.6% of the 1,193 evaluated 4th downs; coaches went on 16.3%.
- 103 of the 110 mistakes (93.6%) are kicks nfl4th would have gone for (punts, field goals
  or extra points where it says go or go for 2).
- 96 of the 110 (87.3%) had nfl4th's top two options within 5 points of win probability
  (`closeMargin`), so most flagged calls are close ones for the model too.

## Counts, 2026 weeks 1 to 6 (93 games)

| Category | Plays |
|---|---|
| 4th down rows | 1,445 |
| Pre-snap penalties before a 4th down snap | 80 |
| Delay of game, then a kick (graded at the spot before it) | 43 |
| Delay of game, then went for it (graded at the snap) | 6 |
| Nullified by a post-snap penalty (skipped) | 38 |
| Fakes (counted as go) | 5 |
| Snaps right after a timeout by the offense / defense | 44 / 71 |
| Kneels and spikes (skipped) | 1 |
| 4th down decisions (1,445 - 80 - 38 - 1) | 1,326 |
| Tries (429 extra points, 43 two-point tries) | 472 |
| Tries retaken after a penalty | 0 (the 4 extra point penalties were enforced on the kickoff) |
| Overtime / endgame (not supported) | 14 / 17 |
| A choice the model leaves out | 0 |
| Game already decided | 157 |
| Graded 4th downs / tries | 97 / 13 |

Of the 97 graded 4th downs, 62 are punts and 29 field goals where nfl4th says go.

## Validation against rbsdm.com

rbsdm.com's Fourth Downs tab shows nfl4th's `go_boost` for each play: the win probability
of going for it minus the best kick, in points, to one decimal place. Ten 2026 plays were
copied by hand on 2026-10-22 (`tests/fixtures/decisions/rbsdm-2026-10-22.json`) and are
compared by `docs/methods/scripts/rbsdm_compare.py`. They cover 3 goes, 5 punts (2 after a
delay of game) and 2 field goals. rbsdm shows no numbers for tries, so none is compared.

| Team | Wk | Yards to goal | To go | rbsdm | Here | Best kick |
|---|---|---|---|---|---|---|
| SEA | 6 | 67 | 2 | 1.3 | 1.3 | punt |
| SEA | 5 | 50 | 10 | 9.9 | 10.1 | field goal |
| SEA | 5 | 25 | 3 | 1.1 | 1.8 | field goal |
| SEA | 3 | 2 | 2 | 2.3 | 2.7 | field goal |
| SEA | 3 | 72 | 2 | 2.2 | 2.2 | punt |
| SEA | 3 | 47 | 5 | 1.1 | 1.1 | punt, after a delay of game |
| SEA | 1 | 45 | 1 | 7.6 | 7.6 | punt |
| SEA | 1 | 52 | 4 | 1.8 | 1.8 | punt |
| HOU | 2 | 40 | 1 | 6.8 | 7.3 | field goal |
| HOU | 3 | 91 | 2 | 2.1 | 2.2 | punt, after a delay of game |

Where the best kick is a punt, all six agree to within rbsdm's rounding (0.1). Where it is
a field goal, all four come out 0.2 to 0.7 points higher here.

The cause is the kickoff after a score. The port is nfl4th at `ecb7293`, the merge of
nfl4th #61 (2026-10-21), which starts kickoffs after scores at the receiving team's 30 from
2024 on. Run with the kickoff at the 25 instead (a throwaway copy of the engine, not the
site's), 9 of the 10 match rbsdm exactly and the tenth differs by 0.1. So rbsdm's 2026
numbers still use the 25. A field goal is followed by a kickoff, a punt is not, which is
why only plays with a field goal in range differ. The port is the newer of the two, and
the delay of game rule grades those two punts at the same spot rbsdm lists them.

Rerun on 2026-10-22 after recomputing the season (still 93 games, weeks 1 to 6): the same
ten numbers here, and rbsdm's unchanged ("Data updated: 10/22/2026, 01:15" on rbsdm, before
nfl4th #63 was merged that afternoon).

The fourth-down repo re-pins the port to nfl4th `395d4b9`, the same #61 merge under its
rewritten history: identical code and outputs, so nothing here changes.

rbsdm may move to a newer nfl4th than the port, for example #63's field goal changes
(below). If it does, plays with a field goal in range may differ by more than they do now,
and the comparison should be rerun before reading anything into a larger gap.

Also seen: rbsdm lists some plays this pipeline skips by rule, such as a punt nullified by
a defensive penalty (HOU week 6), and lists a delay of game row itself where this
pipeline grades the kick that follows from the same spot.

## Limitations

- nfl4th merged #63 on 2026-10-22, after `ecb7293`: field goal make probability corrected
  for selection bias on long attempts (5 to 10 points lower from 55 to 61 yards) and the
  field goal era cutoff moved to 2023. Neither is in the port; it will come as a normal
  model change from the fourth-down repo, and the next run recomputes the season.
- Not team-adjusted, a league-average kicker, no temperature (as the calculator).
- The cost is at the snap. It says nothing about the play that was called.
- decisions.json is about 1.3 MB through week 6, one record per line, and will be about
  3.5 MB by the season's end. It changes about every other day (whenever play-by-play
  adds finals, at most every 12 hours). Replaying the season's 12 versions so far into a
  scratch repository, git packs each new version as about 7 KB of delta, in this format
  or in one line: about 0.4 MB more by the Super Bowl. Before git packs them, each
  version is a full compressed copy (140 to 430 KB), about 17 MB by the Super Bowl at
  worst.
