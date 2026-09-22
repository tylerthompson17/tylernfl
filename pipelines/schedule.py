"""Build src/data/schedule.json: every game of a season, for team pages
and playoff odds. Written daily from the nflverse schedule the ticker
already loads.

Lines are nflverse's as published: spread_line is how many points the
home team is favored by (negative when the road team is favored), and the
moneylines are American odds. They appear about a week before a game, so
most future games have none.
"""

from common import normalize_team
from ticker import kickoff_utc

GAME_TYPES = {'REG', 'WC', 'DIV', 'CON', 'SB'}


def _int(value):
    return None if value is None else int(value)


def build_schedule(schedule_rows: list[dict], season: int, updated: str) -> dict:
    """The ScheduleData shape in src/data/types.ts, for one season."""
    games = []
    for row in schedule_rows:
        if row['season'] != season or row['game_type'] not in GAME_TYPES:
            continue
        games.append({
            'id': row['game_id'],
            'week': row['week'],
            'type': row['game_type'],
            'kickoff': kickoff_utc(row),
            'away': normalize_team(row['away_team']),
            'home': normalize_team(row['home_team']),
            'awayScore': _int(row.get('away_score')),
            'homeScore': _int(row.get('home_score')),
            'overtime': bool(row.get('overtime')),
            'divisional': bool(row.get('div_game')),
            'neutral': row.get('location') == 'Neutral',
            'spreadLine': row.get('spread_line'),
            'awayMoneyline': _int(row.get('away_moneyline')),
            'homeMoneyline': _int(row.get('home_moneyline')),
        })
    games.sort(key=lambda g: (g['week'], g['kickoff'] or '9999', g['id']))
    return {'season': season, 'updated': updated, 'games': games}
