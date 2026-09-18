"""Build src/data/stats/{board}.json: full player leaderboards from nflverse weekly stats.

One file per board (passing, rushing, receiving, defense, kicking), every
player with any volume in it, regular season only. The site sorts and
switches between totals and per game in the browser; this module decides
what the numbers are and who qualifies.

Games are the games a player has a stat row in, which matches nflverse's
own `games` column. Team games count the games their current team has
played, and set the qualifying bar.

Qualifying: rate columns (Y/A, Cmp%) and the per game view rank only
qualified players, so a 1-for-1 passer never leads completion percentage.
Each board sets one bar in its main volume stat, per team game, so it
scales through the season. The bars are this site's choices, not an
official standard.
"""

from dataclasses import dataclass, field

from common import missing_season, normalize_team


@dataclass(frozen=True)
class Column:
    key: str
    label: str
    # Full name for the column header's tooltip and screen readers.
    title: str
    fmt: str = 'integer'  # integer | decimal1 | percent1
    # Counting columns sum this nflverse column (default: key).
    source: str | None = None
    # Rate columns divide one output column by another.
    rate: tuple[str, str] | None = None
    # 'max' for bests like the longest field goal.
    agg: str = 'sum'
    better: str = 'high'

    @property
    def per_game(self) -> bool:
        return self.rate is None and self.agg == 'sum' and self.key != 'games'


@dataclass(frozen=True)
class Qualifier:
    column: str
    per_team_game: float
    text: str


@dataclass(frozen=True)
class Board:
    key: str
    label: str
    primary: str
    # A player appears when any of these is above zero.
    include: tuple[str, ...]
    qualifier: Qualifier
    columns: tuple[Column, ...] = field(default=())


GAMES = Column('games', 'G', 'Games played')

BOARDS = [
    Board(
        'passing', 'Passing', 'passing_yards', ('attempts',),
        Qualifier('attempts', 14, 'At least 14 pass attempts per team game.'),
        (
            GAMES,
            Column('completions', 'Cmp', 'Completions'),
            Column('attempts', 'Att', 'Pass attempts'),
            Column('cmp_pct', 'Cmp%', 'Completion percentage', 'percent1', rate=('completions', 'attempts')),
            Column('passing_yards', 'Yds', 'Passing yards'),
            Column('pass_ypa', 'Y/A', 'Yards per pass attempt', 'decimal1', rate=('passing_yards', 'attempts')),
            Column('passing_tds', 'TD', 'Passing touchdowns'),
            Column('passing_interceptions', 'Int', 'Interceptions thrown', better='low'),
            Column('sacks_suffered', 'Sk', 'Times sacked', better='low'),
        ),
    ),
    Board(
        'rushing', 'Rushing', 'rushing_yards', ('carries',),
        Qualifier('carries', 6, 'At least 6 carries per team game.'),
        (
            GAMES,
            Column('carries', 'Att', 'Carries'),
            Column('rushing_yards', 'Yds', 'Rushing yards'),
            Column('rush_ypc', 'Y/A', 'Yards per carry', 'decimal1', rate=('rushing_yards', 'carries')),
            Column('rushing_tds', 'TD', 'Rushing touchdowns'),
            Column('rushing_first_downs', '1D', 'Rushing first downs'),
            Column('rushing_fumbles_lost', 'FL', 'Fumbles lost on runs', better='low'),
        ),
    ),
    Board(
        'receiving', 'Receiving', 'receiving_yards', ('targets', 'receptions'),
        Qualifier('targets', 3, 'At least 3 targets per team game.'),
        (
            GAMES,
            Column('targets', 'Tgt', 'Targets'),
            Column('receptions', 'Rec', 'Receptions'),
            Column('catch_pct', 'Catch%', 'Receptions per target', 'percent1', rate=('receptions', 'targets')),
            Column('receiving_yards', 'Yds', 'Receiving yards'),
            Column('rec_ypr', 'Y/R', 'Yards per reception', 'decimal1', rate=('receiving_yards', 'receptions')),
            Column('receiving_tds', 'TD', 'Receiving touchdowns'),
            Column('receiving_first_downs', '1D', 'Receiving first downs'),
        ),
    ),
    Board(
        'defense', 'Defense', 'def_sacks',
        ('def_tackles_solo', 'def_tackle_assists', 'def_sacks', 'def_interceptions', 'def_pass_defended'),
        # No rate columns here; the bar only applies to the per game view.
        Qualifier('games', 0.5, 'Played in at least half of team games.'),
        (
            GAMES,
            Column('def_tackles_solo', 'Solo', 'Solo tackles'),
            Column('def_tackle_assists', 'Ast', 'Assisted tackles'),
            Column('def_tackles_for_loss', 'TFL', 'Tackles for loss'),
            Column('def_sacks', 'Sk', 'Sacks', 'decimal1'),
            Column('def_qb_hits', 'QBH', 'Quarterback hits'),
            Column('def_interceptions', 'Int', 'Interceptions'),
            Column('def_pass_defended', 'PD', 'Passes defended'),
            Column('def_fumbles_forced', 'FF', 'Fumbles forced'),
        ),
    ),
    Board(
        'kicking', 'Kicking', 'fg_made', ('fg_att', 'pat_att'),
        Qualifier('fg_att', 1, 'At least 1 field goal attempt per team game.'),
        (
            GAMES,
            Column('fg_made', 'FGM', 'Field goals made'),
            Column('fg_att', 'FGA', 'Field goals attempted'),
            Column('fg_pct', 'FG%', 'Field goal percentage', 'percent1', rate=('fg_made', 'fg_att')),
            Column('fg_long', 'Lng', 'Longest field goal made', agg='max'),
            Column('pat_made', 'XPM', 'Extra points made'),
            Column('pat_att', 'XPA', 'Extra points attempted'),
            Column('xp_pct', 'XP%', 'Extra point percentage', 'percent1', rate=('pat_made', 'pat_att')),
        ),
    ),
]

# Static routes under /stats that a board key must never shadow.
RESERVED_KEYS = {'teams', 'index'}
assert not RESERVED_KEYS & {b.key for b in BOARDS}, 'board key collides with a /stats route'

# Rates are stored at the precision the site shows them (57.5%, 7.4), so two
# players showing the same number always tie.
RATE_DECIMALS = {'percent1': 3, 'decimal1': 1}

PLAYER_COLUMNS = ['player_id', 'player_display_name', 'position', 'team', 'week', 'game_id']
STAT_COLUMNS = sorted(
    {c.source or c.key for b in BOARDS for c in b.columns if c.rate is None and c.key != 'games'}
)


def tie_rank(value, values: list, better: str) -> int:
    if better == 'high':
        return 1 + sum(1 for v in values if v > value)
    return 1 + sum(1 for v in values if v < value)


def build_board(board: Board, players: dict[str, dict], team_games: dict[str, int], season: int, through_week: int) -> dict:
    rows = []
    for p in players.values():
        values: dict[str, float | int | None] = {'games': len(p['games'])}
        for col in board.columns:
            if col.key == 'games' or col.rate:
                continue
            source = col.source or col.key
            if col.agg == 'max':
                present = [v for v in p['max'][source] if v is not None]
                values[col.key] = max(present) if present else None
            else:
                total = p['sum'][source]
                values[col.key] = int(total) if col.fmt == 'integer' else round(total, 1)
        if not any((values.get(key) or 0) > 0 for key in board.include):
            continue
        for col in board.columns:
            if col.rate:
                num, den = values[col.rate[0]], values[col.rate[1]]
                values[col.key] = round(num / den, RATE_DECIMALS[col.fmt]) if den else None

        needed = board.qualifier.per_team_game * team_games.get(p['team'], 0)
        rows.append(
            {
                'playerId': p['id'],
                'player': p['name'],
                'team': p['team'],
                'position': p['position'],
                'teamGames': team_games.get(p['team'], 0),
                'qualified': (values[board.qualifier.column] or 0) >= needed,
                'values': values,
            }
        )

    primary = next(c for c in board.columns if c.key == board.primary)
    ranked = [r['values'][board.primary] or 0 for r in rows]
    for row in rows:
        row['rank'] = tie_rank(row['values'][board.primary] or 0, ranked, primary.better)
    rows.sort(key=lambda r: (r['rank'], r['player']))
    rows = [{'rank': r.pop('rank'), **r} for r in rows]

    return {
        'key': board.key,
        'label': board.label,
        'season': season,
        'throughWeek': through_week,
        'primary': board.primary,
        'qualifier': {
            'column': board.qualifier.column,
            'perTeamGame': board.qualifier.per_team_game,
            'text': board.qualifier.text,
        },
        'columns': [
            {
                'key': c.key,
                'label': c.label,
                'title': c.title,
                'format': c.fmt,
                'perGame': c.per_game,
                'rate': c.rate is not None,
                'better': c.better,
            }
            for c in board.columns
        ],
        'rows': rows,
    }


def build_leaderboards(rows: list[dict], season: int) -> dict[str, dict]:
    """Pure function from weekly REG player rows to one LeaderboardData per board key."""
    players: dict[str, dict] = {}
    team_game_ids: dict[str, set[str]] = {}
    for r in sorted(rows, key=lambda r: r['week']):
        team = normalize_team(r['team'])
        team_game_ids.setdefault(team, set()).add(r['game_id'])
        p = players.setdefault(
            r['player_id'],
            {
                'id': r['player_id'],
                'games': set(),
                'sum': {c: 0 for c in STAT_COLUMNS},
                'max': {c: [] for c in STAT_COLUMNS},
            },
        )
        # Most recent week wins, so traded players show their current team.
        p.update(name=r['player_display_name'], team=team, position=r['position'])
        p['games'].add(r['game_id'])
        for c in STAT_COLUMNS:
            p['sum'][c] += r.get(c) or 0
            p['max'][c].append(r.get(c))

    team_games = {team: len(ids) for team, ids in team_game_ids.items()}
    through_week = max((r['week'] for r in rows), default=0)
    return {b.key: build_board(b, players, team_games, season, through_week) for b in BOARDS}


def load_player_week_rows(season: int) -> list[dict]:
    """Weekly regular season player stats: every column the leaders and boards need."""
    import nflreadpy as nfl
    import polars as pl

    try:
        stats = nfl.load_player_stats(season, summary_level='week')
    except ConnectionError as error:
        # A season has no file until its first games are played, so the
        # previous season's boards stay up. Any other failure must stop the
        # run rather than publish stale data as if it were current.
        if missing_season(error):
            return []
        raise
    return stats.filter(pl.col('season_type') == 'REG').select(PLAYER_COLUMNS + STAT_COLUMNS).to_dicts()
