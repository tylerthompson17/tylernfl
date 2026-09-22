"""Playoff odds: writes src/data/playoff_odds.json by simulating the rest
of the regular season many times and seeding each simulated season with
the same NFL tiebreakers as the standings (standings.py, checked against
nflseedR).

Game probabilities are an input, not something this module decides. It
takes a function from the season's unplayed games to each one's chance of
a home win, and GAME_PROBABILITIES names the one in use. There is no team
rating model here: that is Tyler's, and when it exists it replaces
betting_lines, returning the same thing.

The default, betting_lines, reads nflverse's moneylines. Each side's
American odds become an implied probability, and the bookmaker's margin
is taken out by scaling the two to sum to 1; there is nothing to tune.
Lines appear about a week before a game, so every game without one counts
as even odds. Early in the season that is nearly every game, and the odds
are close to records and schedules alone; the page says so.

Simulated games never end in a tie (about 0.3% of real games do).
Simulated scores are 1 to 0, which the tiebreakers never read at this
depth: they stop at strength of schedule, before any point totals.

The random draws are seeded from a hash of the inputs, so a rerun with no
new results and no new lines writes an identical file.
"""

import hashlib
import json
import random
from typing import Callable

import standings

SIMULATIONS = 10_000
SOURCE = 'betting lines'


def implied(american: float) -> float:
    """American odds to the probability they imply, margin included."""
    return -american / (-american + 100) if american < 0 else 100 / (american + 100)


def betting_lines(games: list[dict]) -> dict[str, float]:
    """Home win probability for each game from its moneylines, with the
    bookmaker's margin removed; 0.5 for a game with no line yet."""
    probabilities = {}
    for g in games:
        home, away = g.get('home_moneyline'), g.get('away_moneyline')
        if home is None or away is None:
            probabilities[g['game_id']] = 0.5
            continue
        h, a = implied(home), implied(away)
        probabilities[g['game_id']] = h / (h + a)
    return probabilities


def priced(games: list[dict]) -> int:
    """How many games have a line."""
    return sum(1 for g in games if g.get('home_moneyline') is not None and g.get('away_moneyline') is not None)


# The one place to plug in a different source of game probabilities.
GAME_PROBABILITIES: Callable[[list[dict]], dict[str, float]] = betting_lines


def split_season(schedule_rows: list[dict], season: int) -> tuple[list[dict], list[dict]]:
    """(completed, unplayed) regular season games of a season."""
    completed, unplayed = [], []
    for g in schedule_rows:
        if g['season'] != season or g['game_type'] != 'REG':
            continue
        done = g.get('away_score') is not None and g.get('home_score') is not None
        (completed if done else unplayed).append(g)
    return completed, unplayed


def _seed_for(completed: list[dict], probabilities: dict[str, float], n: int) -> int:
    key = json.dumps([
        sorted((g['game_id'], g['away_score'], g['home_score']) for g in completed),
        sorted((k, round(v, 6)) for k, v in probabilities.items()),
        n,
    ])
    return int(hashlib.sha256(key.encode()).hexdigest()[:16], 16)


def simulate(completed: list[dict], unplayed: list[dict], probabilities: dict[str, float],
             alignment: dict[str, tuple[str, str]], n: int = SIMULATIONS) -> dict[str, dict]:
    """Counts per team over n simulated seasons: playoffs, division, top
    seed, each seed 1 to 7, and total wins (ties in completed games as half)."""
    rng = random.Random(_seed_for(completed, probabilities, n))
    counts = {team: {'playoffs': 0, 'division': 0, 'topSeed': 0, 'seeds': [0] * 7, 'wins': 0.0} for team in alignment}
    for _ in range(n):
        simulated = []
        for g in unplayed:
            home_wins = rng.random() < probabilities.get(g['game_id'], 0.5)
            simulated.append({**g, 'home_score': 1 if home_wins else 0, 'away_score': 0 if home_wins else 1})
        table = standings.compute(completed + simulated, alignment)
        for team, row in table.items():
            c = counts[team]
            c['wins'] += row['wins']
            if row['div_rank'] == 1:
                c['division'] += 1
            if row['conf_rank'] <= 7:
                c['playoffs'] += 1
                c['seeds'][row['conf_rank'] - 1] += 1
            if row['conf_rank'] == 1:
                c['topSeed'] += 1
    return counts


def build_playoff_odds(schedule_rows: list[dict], season: int, updated: str,
                       alignment: dict[str, tuple[str, str]] | None = None,
                       n: int = SIMULATIONS,
                       game_probabilities: Callable[[list[dict]], dict[str, float]] | None = None) -> dict:
    """The PlayoffOddsData shape in src/data/types.ts."""
    alignment = alignment or standings.load_alignment()
    completed, unplayed = split_season(schedule_rows, season)
    if not completed:
        # Before the first game there is nothing but coin flips to show.
        return {'season': season, 'throughWeek': 0, 'updated': updated, 'simulations': 0,
                'source': SOURCE, 'pricedGames': priced(unplayed), 'remainingGames': len(unplayed), 'teams': []}
    probabilities = (game_probabilities or GAME_PROBABILITIES)(unplayed)
    counts = simulate(completed, unplayed, probabilities, alignment, n)
    return {
        'season': season,
        'throughWeek': max((g['week'] for g in completed), default=0),
        'updated': updated,
        'simulations': n,
        'source': SOURCE,
        'pricedGames': priced(unplayed),
        'remainingGames': len(unplayed),
        'teams': [
            {
                'team': team,
                'playoffs': round(c['playoffs'] / n, 3),
                'division': round(c['division'] / n, 3),
                'topSeed': round(c['topSeed'] / n, 3),
                'seeds': [round(s / n, 3) for s in c['seeds']],
                'meanWins': round(c['wins'] / n, 1),
            }
            for team, c in sorted(counts.items())
        ],
    }
