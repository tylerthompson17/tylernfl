"""Team ratings for the playoff odds and the draft projection: a delegated
standard method (CLAUDE.md, Modeling ownership), documented with its
validation in docs/methods/team-ratings.md. Not Tyler's work and not a
model of the game: the ratings only restate what the betting market has
said about each team this season.

Every game of the season with both moneylines, played (its closing line)
or not yet played, gives the market's home win chance with the margin
taken out (playoff_odds.betting_lines). On the logit scale

    logit(P(home wins)) = r_home - r_away + h * (not at a neutral site)

fitted by weighted ridge least squares, in closed form. The ratings sum to
zero, h (home field) is free, and the penalty pulls the ratings, not h,
toward last season's final ratings times CARRYOVER. A game's weight halves
every HALF_LIFE_WEEKS before the latest final; lines still to be played
weigh 1. Last season's final ratings are the same fit over all of last
season's games, playoffs included, pulled toward zero.

Pricing (Pricer): a game with its own moneylines keeps them; every other
game, playoffs included, is priced from the ratings, with no home field at
a neutral site (international games, the Super Bowl). In the simulation each
team's rating is drawn once per simulated season around its estimate, with
spread SIGMA, so a team that is better or worse than its rating is so in all
of its games. Averaging a logistic over normal draws pulls every chance
toward 50/50, so before the draws are added the whole logit (ratings and
home field) is scaled up by sqrt(1 + pi * 2 SIGMA^2 / 8), the logistic-normal
approximation; a game's chance averaged over the draws then matches its
point estimate (within a point; test_team_ratings.py).

CARRYOVER, HALF_LIFE_WEEKS and PENALTY were tuned on the log loss of the
rest of each regular season's results, 2015 to 2025; SIGMA then on the
rest of the season's win totals, so that the spread the draws give a team's
wins matches how far real totals landed
(docs/methods/scripts/team_ratings_backtest.py).
"""

import math
import random
from datetime import date
from typing import Callable

import numpy as np

from common import normalize_team
from playoff_odds import betting_lines

CARRYOVER = 0.55
HALF_LIFE_WEEKS = 2.0
PENALTY = 1.0
SIGMA = 0.65

# Franchises by today's abbreviation, for last season's ratings.
FRANCHISES = {'STL': 'LAR', 'SD': 'LAC', 'OAK': 'LV'}


def franchise(abbr: str) -> str:
    return normalize_team(FRANCHISES.get(abbr, abbr))


def has_line(g: dict) -> bool:
    return g.get('home_moneyline') is not None and g.get('away_moneyline') is not None


def is_neutral(g: dict) -> bool:
    return g.get('location') == 'Neutral'


def logit(p: float) -> float:
    return math.log(p / (1 - p))


def logistic(x: float) -> float:
    return 1 / (1 + math.exp(-x))


def stretch(sigma: float) -> float:
    """How much to scale a logit so that, with two ratings drawn at spread
    sigma (the difference at sigma * sqrt(2)), the averaged chance is the
    unscaled one."""
    return math.sqrt(1 + math.pi * 2 * sigma ** 2 / 8)


def fit(games: list[dict], teams: list[str], as_of: date | None, prior: dict[str, float] | None = None,
        carryover: float = CARRYOVER, half_life_weeks: float = HALF_LIFE_WEEKS,
        penalty: float = PENALTY) -> tuple[dict[str, float], float]:
    """(ratings, home field) from the priced games among `games`. `prior` is
    last season's final ratings (None for none); `as_of` the date ages are
    counted from, and a game after it weighs 1."""
    priced = [g for g in games if has_line(g)]
    index = {t: i for i, t in enumerate(teams)}
    k = len(teams)
    target = np.zeros(k + 1)
    if prior:
        target[:k] = [carryover * prior.get(t, 0.0) for t in teams]
        target[:k] -= target[:k].mean()
    if not any(not is_neutral(g) for g in priced):
        # Nothing to say where home field comes from; the prior alone.
        return {t: float(target[i]) for t, i in index.items()}, 0.0
    x = np.zeros((len(priced), k + 1))
    y = np.empty(len(priced))
    w = np.empty(len(priced))
    probabilities = betting_lines(priced)
    for row, g in enumerate(priced):
        x[row, index[franchise(g['home_team'])]] = 1
        x[row, index[franchise(g['away_team'])]] = -1
        x[row, k] = 0 if is_neutral(g) else 1
        y[row] = logit(probabilities[g['game_id']])
        age = max(0, (as_of - date.fromisoformat(g['gameday'])).days)
        w[row] = 0.5 ** (age / (7 * half_life_weeks))
    # The data never move the ratings' sum (each game adds and takes away
    # the same), so with the penalty on every rating and a target summing
    # to zero, the solution sums to zero too.
    shrink = np.full(k + 1, penalty)
    shrink[k] = 0
    lhs = x.T @ (w[:, None] * x) + np.diag(shrink)
    rhs = x.T @ (w * y) + shrink * target
    theta = np.linalg.solve(lhs, rhs)
    return {t: float(theta[i]) for t, i in index.items()}, float(theta[k])


def final_ratings(schedule_rows: list[dict], season: int, teams: list[str]) -> dict[str, float] | None:
    """A season's ratings at its end, playoffs included, pulled toward zero;
    None when the season has no priced games."""
    games = [g for g in schedule_rows if g['season'] == season and has_line(g) and g.get('home_score') is not None]
    if not games:
        return None
    last = max(date.fromisoformat(g['gameday']) for g in games)
    return fit(games, teams, last)[0]


class Pricer:
    """GAME_PROBABILITIES for playoff_odds: called with games, the home win
    chance of each (its line, else the ratings); draw(rng) gives one
    simulated season's pricer, its ratings drawn around these."""

    def __init__(self, ratings: dict[str, float], home_field: float, sigma: float = SIGMA):
        self.ratings, self.home_field, self.sigma = ratings, home_field, sigma

    def chance(self, g: dict) -> float:
        diff = self.ratings[franchise(g['home_team'])] - self.ratings[franchise(g['away_team'])]
        return logistic(diff + (0 if is_neutral(g) else self.home_field))

    def __call__(self, games: list[dict]) -> dict[str, float]:
        lines = betting_lines([g for g in games if has_line(g)])
        return {g['game_id']: lines[g['game_id']] if has_line(g) else self.chance(g) for g in games}

    def draw(self, rng: random.Random) -> 'Pricer':
        k = stretch(self.sigma)
        drawn = {t: k * r + rng.gauss(0, self.sigma) for t, r in sorted(self.ratings.items())}
        return Pricer(drawn, k * self.home_field, 0)


def pricer(schedule_rows: list[dict], season: int) -> Callable[[list[dict]], dict[str, float]]:
    """The ratings as of the season's latest final, from every priced game of
    the season and last season's final ratings."""
    rows = [g for g in schedule_rows if g['season'] == season]
    teams = sorted({franchise(g[side]) for g in rows for side in ('home_team', 'away_team')})
    lined = [g for g in rows if has_line(g)]
    played = [date.fromisoformat(g['gameday']) for g in lined if g.get('home_score') is not None]
    upcoming = [date.fromisoformat(g['gameday']) for g in lined]
    as_of = max(played) if played else min(upcoming, default=None)
    prior = final_ratings(schedule_rows, season - 1, teams)
    ratings, home_field = fit(rows, teams, as_of, prior)
    return Pricer(ratings, home_field)
