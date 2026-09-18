"""Build src/data/players/{TEAM}.json: every player's game log, grouped by team.

One row per game per leaderboard (passing, rushing, receiving, defense,
kicking) in which the player recorded any counted stat, computed by the
same board_values the leaderboards use, so a log adds up exactly to the
leaderboard row (checked on all of 2025: 16,821 player-stat totals). Season totals and ranks are not repeated here: the site
reads them from stats/{board}.json.

Players are filed under their current team (latest week), with each game
row carrying the team he played for, so a traded player's whole season
sits in one place. Rows are arrays in the column order listed per board at
the top of the file, and files are written compactly: a full season is
about 2,000 players.
"""

from common import normalize_team
from leaderboards import BOARDS, STAT_COLUMNS, board_values


def game_result(team: str, game: dict | None) -> str | None:
    """'W 41-31' from the player's team's side, or None without a final score."""
    if not game or game['away_score'] is None or game['home_score'] is None:
        return None
    home = normalize_team(game['home_team']) == team
    ours, theirs = (game['home_score'], game['away_score']) if home else (game['away_score'], game['home_score'])
    mark = 'W' if ours > theirs else 'L' if ours < theirs else 'T'
    return f'{mark} {ours}-{theirs}'


def build_game_logs(rows: list[dict], schedule_rows: list[dict], season: int) -> dict[str, dict]:
    """Pure function from weekly REG player rows to one PlayerLogsData per team abbr."""
    games = {g['game_id']: g for g in schedule_rows}
    columns = {b.key: [c.key for c in b.columns if c.key != 'games'] for b in BOARDS}
    # Any counted stat puts a game in the log, so the log sums to the season.
    counting = {b.key: tuple(c.key for c in b.columns if c.per_game) for b in BOARDS}
    through_week = max((r['week'] for r in rows), default=0)

    players: dict[str, dict] = {}
    for r in sorted(rows, key=lambda r: r['week']):
        if r['player_id'] is None:
            continue
        team = normalize_team(r['team'])
        player = players.setdefault(r['player_id'], {'boards': {}})
        # Latest week wins, so a traded player is filed under his new team.
        player.update(name=r['player_display_name'], team=team)
        sums = {c: r.get(c) or 0 for c in STAT_COLUMNS}
        maxes = {c: [r.get(c)] for c in STAT_COLUMNS}
        schedule = games.get(r['game_id'])
        home = schedule is not None and normalize_team(schedule['home_team']) == team
        for board in BOARDS:
            values = board_values(board, sums, maxes, 1, counting[board.key])
            if values is None:
                continue
            player['boards'].setdefault(board.key, []).append(
                [r['week'], team, normalize_team(r['opponent_team']), 1 if home else 0,
                 game_result(team, schedule), *(values[k] for k in columns[board.key])]
            )

    files: dict[str, dict] = {}
    for player_id, player in sorted(players.items()):
        if not player['boards']:
            continue
        team_file = files.setdefault(
            player['team'],
            {'season': season, 'throughWeek': through_week, 'team': player['team'],
             'fields': ['week', 'team', 'opponent', 'home', 'result'], 'columns': columns, 'players': {}},
        )
        team_file['players'][player_id] = {'name': player['name'], 'boards': player['boards']}
    return files
