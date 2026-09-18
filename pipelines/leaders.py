"""Build src/data/leaders.json from nflverse weekly player stats.

Regular season totals, top 5 per category, for the home page and the stats
index. Each category links to the full board in leaderboards.py it is the
top of, and both read the same rows (leaderboards.load_player_week_rows),
so the two never disagree.
"""

from common import normalize_team

# key, label, nflverse column, full leaderboard it heads
CATEGORIES = [
    ('pass_yds', 'Passing yards', 'passing_yards', 'passing'),
    ('rush_yds', 'Rushing yards', 'rushing_yards', 'rushing'),
    ('rec_yds', 'Receiving yards', 'receiving_yards', 'receiving'),
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
        for _, _, column, _ in CATEGORIES:
            p[column] += r[column] or 0

    categories = []
    for key, label, column, board in CATEGORIES:
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
                'board': board,
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

