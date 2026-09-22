"""Build src/data/player_epa.json from nflverse play-by-play: EPA per
dropback for passers and EPA per carry on designed runs.

Regular season only, complete weeks only (the same rule and play-by-play
load as team_stats.py), written by the weekly job next to team_stats.json.
EPA is nflfastR's, as published in nflverse play-by-play; these are
standard stat definitions, not a model of this site's.

Definitions (two-point tries never count):
- EPA per dropback: nflfastR's `qb_epa` summed over the quarterback's
  dropbacks (`qb_dropback`: passes, sacks and scrambles), divided by
  dropbacks. `qb_epa` credits the passer only up to a receiver's lost
  fumble. The dropback belongs to the player in nflverse's `id` column,
  the passer, or the rusher on a scramble.
- Rush EPA: `epa` over designed runs (`play_type` run, not a scramble),
  divided by carries, by `rusher_player_id`.

Qualifiers are this site's choice and match the boards in leaderboards.py:
14 dropbacks and 6 carries per team game. Team games are the games the
player's current team has played. Values are rounded to the displayed
precision (3 places) before ranking, so equal shown values share a rank.

Names and teams come from the passing and rushing boards the daily job
writes (stats/passing.json, stats/rushing.json), keyed by gsis id, so a
player reads the same here as everywhere else on the site; play-by-play
only has "P.Mahomes".
"""

import json
from collections import defaultdict

from common import DATA_DIR, normalize_team
from team_stats import last_complete_week

PBP_COLUMNS = [
    'game_id', 'week', 'season_type', 'posteam', 'play_type', 'qb_dropback', 'qb_scramble',
    'two_point_attempt', 'qb_epa', 'epa', 'id', 'name', 'rusher_player_id', 'rusher_player_name',
]

CATEGORIES = [
    {
        'key': 'epa_per_dropback',
        'label': 'EPA per dropback',
        'valueLabel': 'EPA/db',
        'playsLabel': 'Dropbacks',
        'qualifier': {'column': 'dropbacks', 'perTeamGame': 14,
                      'text': 'At least 14 dropbacks per team game.'},
    },
    {
        'key': 'rush_epa',
        'label': 'Rush EPA per carry',
        'valueLabel': 'EPA/att',
        'playsLabel': 'Carries',
        'qualifier': {'column': 'carries', 'perTeamGame': 6,
                      'text': 'At least 6 carries per team game.'},
    },
]


def dropback_plays(plays: list[dict]) -> list[dict]:
    """Dropbacks with a quarterback and an EPA, two-point tries left out."""
    return [
        p for p in plays
        if p.get('qb_dropback') == 1 and not p.get('two_point_attempt')
        and p.get('play_type') in ('pass', 'run') and p.get('id') and p.get('qb_epa') is not None
    ]


def designed_runs(plays: list[dict]) -> list[dict]:
    return [
        p for p in plays
        if p.get('play_type') == 'run' and not p.get('qb_scramble') and not p.get('two_point_attempt')
        and p.get('rusher_player_id') and p.get('epa') is not None
    ]


def team_games(plays: list[dict]) -> dict[str, int]:
    games = defaultdict(set)
    for p in plays:
        if p.get('posteam'):
            games[normalize_team(p['posteam'])].add(p['game_id'])
    return {team: len(ids) for team, ids in games.items()}


def _tally(plays: list[dict], player_key: str, name_key: str, epa_key: str) -> dict[str, dict]:
    players: dict[str, dict] = {}
    for p in sorted(plays, key=lambda p: p['week']):
        entry = players.setdefault(p[player_key], {'epa': 0.0, 'plays': 0})
        entry['epa'] += p[epa_key]
        entry['plays'] += 1
        # The latest play's team and name win, like the boards.
        entry['team'] = normalize_team(p['posteam'])
        entry['name'] = p.get(name_key) or p[player_key]
    return players


def _ranked(players: dict[str, dict], per_team_game: float, games: dict[str, int],
            people: dict[str, tuple[str, str]]) -> list[dict]:
    rows = []
    for player_id, p in players.items():
        name, team = people.get(player_id, (p['name'], p['team']))
        team_games_played = games.get(team, games.get(p['team'], 0))
        if p['plays'] < per_team_game * team_games_played or not p['plays']:
            continue
        rows.append({
            'playerId': player_id, 'player': name, 'team': team,
            'value': round(p['epa'] / p['plays'], 3), 'plays': p['plays'], 'teamGames': team_games_played,
        })
    rows.sort(key=lambda r: (-r['value'], r['player']))
    for r in rows:
        r['rank'] = 1 + sum(1 for o in rows if o['value'] > r['value'])
    return [{'rank': r.pop('rank'), **r} for r in rows]


def board_people() -> dict[str, tuple[str, str]]:
    """gsis id to (full name, current team) from the passing and rushing boards."""
    people = {}
    for board in ('passing', 'rushing'):
        path = DATA_DIR / 'stats' / f'{board}.json'
        if path.exists():
            for row in json.loads(path.read_text())['rows']:
                people.setdefault(row['playerId'], (row['player'], row['team']))
    return people


def build_player_epa(plays: list[dict], season: int, through_week: int, updated: str,
                     people: dict[str, tuple[str, str]] | None = None) -> dict:
    """The PlayerEpaData shape in src/data/types.ts, from regular season plays
    already limited to complete weeks."""
    people = board_people() if people is None else people
    games = team_games(plays)
    tallies = [
        _tally(dropback_plays(plays), 'id', 'name', 'qb_epa'),
        _tally(designed_runs(plays), 'rusher_player_id', 'rusher_player_name', 'epa'),
    ]
    return {
        'season': season,
        'throughWeek': through_week,
        'updated': updated,
        'categories': [
            {**category, 'rows': _ranked(tally, category['qualifier']['perTeamGame'], games, people)}
            for category, tally in zip(CATEGORIES, tallies)
        ],
    }


def load_player_epa_plays(season: int, current_season: int) -> tuple[list[dict], int]:
    """Regular season plays through the last complete week, and that week."""
    import nflreadpy as nfl
    import polars as pl

    from pbp_cache import load_pbp

    pbp = load_pbp(season, current_season)
    if pbp is None:
        return [], 0
    schedule = nfl.load_schedules(season).select('game_id', 'game_type', 'week', 'away_score', 'home_score').to_dicts()
    through = last_complete_week(schedule, set(pbp['game_id'].unique().to_list()))
    plays = (
        pbp.filter((pl.col('season_type') == 'REG') & (pl.col('week') <= through))
        .select([c for c in PBP_COLUMNS if c in pbp.columns])
        .to_dicts()
    )
    return plays, through
