"""Game excitement: src/data/game_excitement.json, written daily by
run_daily.py, and the ticker's one-word label.

For every final of the season nflverse has play-by-play for:

- index: the excitement index, the sum of every play's change in win
  probability, either way, scaled to 60 minutes so overtime's extra plays
  do not count as extra excitement.
- winnerLowWp: the eventual winner's lowest win probability. Null for a
  tie, which has no winner.
- score: what GAME_SCORE gives it. /week ranks by it and the auto chart's
  daily pick is the highest of the day's.
- label: Comeback, Thriller or Shootout, the first of those rules the game
  clears, or null.

Win probability is nflfastR's, as published in nflverse play-by-play
(home_wp, the one without the betting line in it). These are descriptive
numbers about games already played, not a model of this site's.

Every game is computed again on each run, so a correction nflverse makes
to a game's plays reaches its numbers the next morning. A game that is
final in the schedule but not yet in play-by-play (a night game, until
nflverse publishes it overnight) is left out until it is.
"""

from typing import Callable

from common import normalize_team

# The label rules, first match wins. Comeback leads because the score does
# not show it; Shootout is last because the score does.
#
# The cutoffs were set against every 2019 to 2025 regular season game
# (1,871, all but the cancelled 2022 BUF at CIN), aiming for about two
# marked games a week so that a mark still means something. Together they
# mark 13.7% (Comeback 116, Thriller 74, Shootout 67), 2.1 a week.
# Recent seasons run wilder than 2019, so expect somewhat more than that.
COMEBACK_WP = 0.10          # the winner was down to a 1 in 10 chance or less
THRILLER_INDEX = 6.88       # the top 5% of excitement index in 2019 to 2025
SHOOTOUT_POINTS = 65        # both teams' points together
SHOOTOUT_MARGIN = 8         # and still a one-score game at the end


# ---------------------------------------------------------------- plays


def elapsed_minutes(quarter: int, remaining: float) -> float:
    """Minutes since kickoff. nflfastR counts overtime's clock down from
    10:00 again, so overtime runs on from minute 60."""
    return ((3600 - remaining) if quarter <= 4 else (3600 + 600 - remaining)) / 60


def wp_plays(plays: list[dict]) -> list[dict]:
    """Plays with a win probability, in the order they happened."""
    usable = [p for p in plays if None not in (p.get('home_wp'), p.get('game_seconds_remaining'), p.get('qtr'))]
    return sorted(usable, key=lambda p: p['play_id'])


def wp_after(play: dict) -> float:
    """Home win probability once the play is over. nflfastR's home_wp is
    before the snap; home_wp_post is after, missing on a few rows."""
    after = play.get('home_wp_post')
    return play['home_wp'] if after is None else after


def winner_low(plays: list[dict], home_won: bool) -> tuple[float, dict]:
    """The winner's lowest win probability before the result, and the play
    it came after. The first low point wins a tie, the earliest scare."""
    lowest = min(plays, key=lambda p: p['home_wp'] if home_won else 1 - p['home_wp'])
    wp = lowest['home_wp'] if home_won else 1 - lowest['home_wp']
    return wp, lowest


# ---------------------------------------------------------------- the numbers


def excitement_index(plays: list[dict]) -> float:
    """Every change in home win probability, either way, added up from
    before the first snap to after the last play, per 60 minutes. A game
    that went to overtime is scaled down by the time it took."""
    if not plays:
        return 0.0
    series = [plays[0]['home_wp'], *(wp_after(p) for p in plays)]
    swing = sum(abs(b - a) for a, b in zip(series, series[1:]))
    minutes = max(60.0, elapsed_minutes(plays[-1]['qtr'], plays[-1]['game_seconds_remaining']))
    return swing * 60 / minutes


def label(index: float, low: float | None, margin: int, points: int) -> str | None:
    """The one-word mark for a game, or None. Takes the numbers as written
    (index to 2 places, low to 3), so the file never shows a value that
    looks short of its own label."""
    if low is not None and low <= COMEBACK_WP:
        return 'Comeback'
    if index >= THRILLER_INDEX:
        return 'Thriller'
    if points >= SHOOTOUT_POINTS and margin <= SHOOTOUT_MARGIN:
        return 'Shootout'
    return None


def by_index(games: list[tuple[dict, list[dict]]]) -> dict[str, float]:
    """The default GAME_SCORE: the excitement index alone."""
    return {row['game_id']: round(excitement_index(plays), 2) for row, plays in games}


# How games are ranked, on /week and for the auto chart's daily pick: a
# function from finals, each with its win probability plays, to a score per
# game_id, highest first. Any replacement takes the same pairs and returns
# the same thing.
GAME_SCORE: Callable[[list[tuple[dict, list[dict]]]], dict[str, float]] = by_index


def build_game_excitement(played: list[tuple[dict, list[dict]]], season: int, updated: str) -> dict:
    """The GameExcitementData shape in src/data/types.ts, from (schedule
    row, win probability plays) pairs in kickoff order."""
    scores = GAME_SCORE(played)
    games = []
    for row, plays in played:
        away, home = row['away_score'], row['home_score']
        low = None if away == home else round(winner_low(plays, home > away)[0], 3)
        index = round(excitement_index(plays), 2)
        margin, points = abs(home - away), away + home
        games.append({
            'id': row['game_id'],
            'week': row['week'],
            'away': normalize_team(row['away_team']),
            'home': normalize_team(row['home_team']),
            'index': index,
            'winnerLowWp': low,
            'score': scores[row['game_id']],
            'label': label(index, low, margin, points),
        })
    return {'season': season, 'updated': updated, 'games': games}


def labels_by_game(excitement: dict) -> dict[str, str]:
    """Game id to label, for the games that have one."""
    return {game['id']: game['label'] for game in excitement['games'] if game['label']}
