"""Reference distributions for the notable performances panel: writes
src/data/performance_percentiles.json from nflverse weekly player stats.

A delegated method (docs/methods/notable-performances.md). For each of the
panel's five categories, the pool is every regular season team game from
1999 through the last completed season, and each team game contributes one
value: the team's best in that stat that game (its top passer's yards, its
top sack getter's sacks, and so on). Field goals count only team games with
at least one attempt. The site places a performance in this pool
(src/lib/performances/notable.ts), so a 2-sack game is measured against
what a team's leading pass rusher usually does, not against every defender
on the field, most of whom get none.

The file holds counts per value, not the games themselves, and changes only
when a season is completed: run_daily.py rebuilds it when the season it
covers is out of date and leaves it alone otherwise, so the 27 season
download happens about once a year.
"""

from datetime import date

FIRST_SEASON = 1999

# Board key, the stat it is ranked on, and a condition for a team game to
# count. Stats match the game logs' column names in players/{TEAM}.json.
CATEGORIES = [
    ('passing', 'passing_yards', None),
    ('rushing', 'rushing_yards', None),
    ('receiving', 'receiving_yards', None),
    ('defense', 'def_sacks', None),
    ('kicking', 'fg_made', 'fg_att'),
]


def last_completed_season(today: date) -> int:
    """The newest season whose regular season is over: the Super Bowl is
    in February, so from March the season that started last September."""
    return today.year - 1 if today.month >= 3 else today.year - 2


def team_leader_counts(rows: list[dict]) -> dict[str, dict[float, int]]:
    """Per board, how many team games had each best value. `rows` are
    weekly player stat rows (season, week, team and the stat columns)."""
    best: dict[str, dict[tuple, float]] = {board: {} for board, _, _ in CATEGORIES}
    for r in rows:
        # One 1999 row has no team; it would otherwise be a team game of its own.
        if not r.get('team'):
            continue
        game = (r['season'], r['week'], r['team'])
        for board, stat, needs in CATEGORIES:
            if needs is not None and not (r.get(needs) or 0) > 0:
                continue
            value = float(r.get(stat) or 0)
            leaders = best[board]
            if game not in leaders or value > leaders[game]:
                leaders[game] = value
    counts: dict[str, dict[float, int]] = {}
    for board, leaders in best.items():
        tally: dict[float, int] = {}
        for value in leaders.values():
            tally[value] = tally.get(value, 0) + 1
        counts[board] = tally
    return counts


def build_performance_percentiles(rows: list[dict], through: int) -> dict:
    """The PerformancePercentilesData shape in src/data/types.ts."""
    counts = team_leader_counts(rows)
    return {
        'fromSeason': FIRST_SEASON,
        'throughSeason': through,
        'categories': {
            board: {
                'stat': stat,
                'games': sum(counts[board].values()),
                # [value, team games], lowest value first. Whole numbers are
                # written as such so yards read as 312, not 312.0.
                'values': [[int(v) if v == int(v) else v, n] for v, n in sorted(counts[board].items())],
            }
            for board, stat, _ in CATEGORIES
        },
    }


def load_rows(through: int) -> list[dict]:
    import nflreadpy as nfl
    import polars as pl

    columns = ['season', 'week', 'team'] + sorted(
        {stat for _, stat, _ in CATEGORIES} | {needs for _, _, needs in CATEGORIES if needs})
    stats = nfl.load_player_stats(list(range(FIRST_SEASON, through + 1)), summary_level='week')
    return stats.filter(pl.col('season_type') == 'REG').select(columns).to_dicts()
