"""Build src/data/leaders.json from nflverse weekly player stats.

Regular season totals, top 5 per category. Before the first regular season
week of a new season has stats, the previous season's final leaders stay up.
"""

from common import load_with_fallback, missing_season, normalize_team

CATEGORIES = [
    ('pass_yds', 'Passing yards', 'passing_yards'),
    ('rush_yds', 'Rushing yards', 'rushing_yards'),
    ('rec_yds', 'Receiving yards', 'receiving_yards'),
]
TOP_N = 5


def build_leaders(rows: list[dict], season: int) -> dict:
    """Pure function from weekly REG player rows to the LeadersData shape in src/data/types.ts."""
    through_week = max((r['week'] for r in rows), default=0)

    players: dict[str, dict] = {}
    for r in sorted(rows, key=lambda r: r['week']):
        p = players.setdefault(
            r['player_id'],
            {'player': r['player_display_name'], 'team': r['team'], **{c[2]: 0 for c in CATEGORIES}},
        )
        # Most recent week wins, so traded players show their current team.
        p['player'] = r['player_display_name']
        p['team'] = r['team']
        for _, _, column in CATEGORIES:
            p[column] += r[column] or 0

    categories = []
    for key, label, column in CATEGORIES:
        ranked = sorted(
            (p for p in players.values() if p[column] > 0),
            key=lambda p: (-p[column], p['player']),
        )
        top = ranked[:TOP_N]
        categories.append(
            {
                'key': key,
                'label': label,
                'valueLabel': 'Yds',
                'rows': [
                    {
                        # Tied players share a rank (1, 2, 2, 4).
                        'rank': 1 + sum(1 for q in ranked if q[column] > p[column]),
                        'player': p['player'],
                        'team': normalize_team(p['team']),
                        'value': p[column],
                    }
                    for p in top
                ],
            }
        )

    return {'season': season, 'throughWeek': through_week, 'categories': categories}


def load_regular_season_rows(season: int) -> list[dict]:
    import nflreadpy as nfl
    import polars as pl

    columns = ['player_id', 'player_display_name', 'team', 'week'] + [c[2] for c in CATEGORIES]
    try:
        stats = nfl.load_player_stats(season, summary_level='week')
    except ConnectionError as error:
        # A season has no file until its first games are played, so the
        # previous season's leaders stay up. Any other failure must stop the
        # run rather than publish stale data as if it were current.
        if missing_season(error):
            return []
        raise
    return stats.filter(pl.col('season_type') == 'REG').select(columns).to_dicts()


def load_leaders_input(current_season: int) -> tuple[list[dict], int]:
    return load_with_fallback(load_regular_season_rows, current_season)
