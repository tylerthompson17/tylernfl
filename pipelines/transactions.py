"""Build src/data/transactions.json: roster moves and the injury report.

Roster moves are derived, not reported. nflverse publishes a roster
snapshot per week (load_rosters_weekly); this compares each player in the
latest week with the last snapshot he appeared in, and names what changed.
That means:
- Moves are dated by week, not day, and a player signed and released in
  the same week never shows.
- Game-day inactives (INA) and moves between the active roster and the
  practice squad are not moves here. Practice squad players called up for
  a game show as active that week and back on the practice squad the next,
  and the data has no field that tells a call-up from a real promotion.
- Missing from a snapshot means nothing. A team on its bye has no snapshot
  at all, and in 2025, 97% of players who vanished from a week with no
  status came back later on the same team. So a player only leaves when a
  status row says so (released, retired), and comparing against the last
  week he appeared, not strictly the week before, keeps a bye from turning
  a whole roster into new signings.

The injury report is nflverse's load_injuries for the week the ticker
shows. Game statuses (Out, Doubtful, Questionable) arrive with each team's
last report before its game, so early in the week most players carry only
their practice participation.

Every item also gets a snap share, a news category and a priority, so the
site can put the news a fan cares about first and filter the full wire:
- Snap share is a player's average share of offensive or defensive snaps
  over his last SNAP_GAMES games, this season and last (load_snap_counts),
  so a starter hurt before week 1 still reads as one. At STARTER_SHARE or
  more he counts as a starter.
- Priority puts news (game statuses and real moves) ahead of routine items
  (practice squad moves and practice reports), so a starter at full
  practice never outranks a Questionable tag. Within each, starters come
  first, then the category order: game statuses (Out, Doubtful,
  Questionable), reserve placements, team changes, activations, signings,
  releases; then practice squad moves and practice reports (did not
  practice, limited, full).

Status groups follow the nflverse roster status dictionary; see rosters.py.
"""

from common import missing_season, normalize_team
from rosters import LEFT_STATUSES, STATUS_LABELS

# Statuses that count as the same place for diffing: a game-day inactive or
# a practice squad call-up is not a transaction.
GROUPS = {
    'ACT': 'roster', 'INA': 'roster', 'DEV': 'roster',
    'RES': 'reserve', 'RSN': 'reserve', 'PUP': 'reserve',
    'EXE': 'exempt', 'E14': 'exempt',
    'SUS': 'suspended',
}
PRACTICE_SQUAD = 'DEV'
PRACTICE_SQUAD_EXITS = {'TRC', 'TRD', 'TRT'}

# Moves the reader cares most about come first: reserve placements and
# team changes, then signings and releases, practice squad churn last.
TYPE_ORDER = {'status': 0, 'joined': 1, 'signed': 2, 'released': 3, 'retired': 4, 'left': 5}

GAME_STATUS_ORDER = {'Out': 0, 'Doubtful': 1, 'Questionable': 2}
PRACTICE_LABELS = {
    'Full Participation in Practice': 'Full',
    'Limited Participation in Practice': 'Limited',
    'Did Not Participate In Practice': 'Did not practice',
}

SNAP_GAMES = 8
STARTER_SHARE = 0.5

# Filter categories for the wire, in priority order. Game statuses sort
# Out, Doubtful, Questionable within their category.
CATEGORIES = [
    ('game-status', 'Game status'),
    ('reserve', 'Reserve list'),
    ('team-change', 'Team changes'),
    ('activated', 'Activations'),
    ('signed', 'Signings'),
    ('released', 'Releases'),
    ('retired', 'Retirements'),
    ('practice-squad', 'Practice squad'),
    ('practice-report', 'Practice report'),
]
CATEGORY_ORDER = {key: i for i, (key, _) in enumerate(CATEGORIES)}
# Routine items sit below all news; within each, starters come first.
ROUTINE = {'practice-squad', 'practice-report'}
ROUTINE_OFFSET = 200
NON_STARTER_OFFSET = 100
PRACTICE_ORDER = {'Did not practice': 0, 'Limited': 1, 'Full': 2}

SNAP_COLUMNS = ['season', 'week', 'pfr_player_id', 'offense_pct', 'defense_pct']

WEEKLY_COLUMNS = ['week', 'team', 'status', 'full_name', 'gsis_id', 'position', 'depth_chart_position']
INJURY_COLUMNS = [
    'week', 'team', 'gsis_id', 'full_name', 'position', 'report_primary_injury',
    'practice_primary_injury', 'report_status', 'practice_status',
]


def status_note(before: str, after: str) -> str | None:
    """Words for a status change on the same team, or None if it is not a move."""
    old, new = GROUPS[before], GROUPS[after]
    if old == new:
        return None
    if new == 'reserve':
        return 'Placed on PUP list' if after == 'PUP' else 'Placed on reserve list'
    if new == 'exempt':
        return 'Placed on exempt list'
    if new == 'suspended':
        return 'Suspended'
    if new == 'roster':
        return {
            'reserve': 'Activated from PUP list' if before == 'PUP' else 'Activated from reserve list',
            'exempt': 'Activated from exempt list',
            'suspended': 'Reinstated from suspension',
        }[old]
    return f'Moved to {STATUS_LABELS[after].lower()}'


def exit_note(before: str, after: str) -> tuple[str, str]:
    """Type and words for a player whose status row says he left a roster."""
    if after == 'RET':
        return 'retired', 'Retired'
    if after == 'TRL':
        return 'left', 'Left the roster'
    if after == 'RSR':
        return 'released', 'Released from reserve list'
    if before == PRACTICE_SQUAD or after in PRACTICE_SQUAD_EXITS:
        return 'released', 'Released from practice squad'
    return 'released', 'Released'


def snap_shares(snap_rows: list[dict], pfr_to_gsis: dict[str, str]) -> dict[str, float]:
    """gsis id -> average offense or defense snap share over the last SNAP_GAMES games."""
    games: dict[str, list[tuple[int, int, float]]] = {}
    for r in snap_rows:
        gsis = pfr_to_gsis.get(r['pfr_player_id'])
        if gsis is None:
            continue
        share = max(r['offense_pct'] or 0.0, r['defense_pct'] or 0.0)
        games.setdefault(gsis, []).append((r['season'], r['week'], share))
    return {
        gsis: sum(g[2] for g in recent) / len(recent)
        for gsis, played in games.items()
        for recent in [sorted(played)[-SNAP_GAMES:]]
    }


def move_category(move: dict) -> str:
    if move['practiceSquad']:
        return 'practice-squad'
    if move['type'] == 'status':
        return 'activated' if move['note'].startswith(('Activated', 'Reinstated')) else 'reserve'
    return {'joined': 'team-change', 'signed': 'signed', 'released': 'released',
            'retired': 'retired', 'left': 'released'}[move['type']]


def rank_items(items: list[dict], shares: dict[str, float]) -> None:
    """Add snapShare, starter and priority to moves and injury entries, in place."""
    for item in items:
        share = shares.get(item['playerId'])
        item['snapShare'] = None if share is None else round(share, 2)
        starter = share is not None and share >= STARTER_SHARE
        item['starter'] = starter
        within = (
            PRACTICE_ORDER.get(item.get('practice'), len(PRACTICE_ORDER))
            if item['category'] == 'practice-report'
            else GAME_STATUS_ORDER.get(item.get('status'), 0)
        )
        item['priority'] = (
            (ROUTINE_OFFSET if item['category'] in ROUTINE else 0)
            + (0 if starter else NON_STARTER_OFFSET)
            + CATEGORY_ORDER[item['category']] * 10
            + within
        )


def diff_rosters(rows: list[dict]) -> tuple[int | None, int | None, list[dict]]:
    """(latest week, week before it, moves) from weekly roster rows.

    Each player in the latest week is compared with the last earlier week he
    appears in, which is usually the week before but not after a bye.
    """
    weeks = sorted({r['week'] for r in rows})
    if len(weeks) < 2:
        return (weeks[-1] if weeks else None), None, []
    week, previous = weeks[-1], weeks[-2]

    after: dict[str, dict] = {}
    before: dict[str, dict] = {}
    for r in rows:
        if not r['gsis_id']:
            continue
        if r['week'] == week:
            after[r['gsis_id']] = r
        elif r['gsis_id'] not in before or r['week'] > before[r['gsis_id']]['week']:
            before[r['gsis_id']] = r

    moves = []
    for player_id, new in after.items():
        old = before.get(player_id)
        old_on = old is not None and old['status'] in GROUPS
        new_on = new['status'] in GROUPS
        # A status the dictionary does not cover says nothing reliable.
        unknown = [r['status'] for r in (old, new) if r and r['status'] not in GROUPS and r['status'] not in LEFT_STATUSES]
        if unknown:
            continue

        base = {
            'playerId': player_id,
            'player': new['full_name'],
            'position': new['depth_chart_position'] or new['position'],
        }
        if not old_on and new_on:
            team = normalize_team(new['team'])
            squad = new['status'] == PRACTICE_SQUAD
            moves.append({**base, 'team': team, 'fromTeam': None, 'type': 'signed', 'practiceSquad': squad,
                          'note': 'Signed to practice squad' if squad else 'Signed'})
        elif old_on and not new_on:
            kind, note = exit_note(old['status'], new['status'])
            moves.append({**base, 'team': normalize_team(old['team']), 'fromTeam': None, 'type': kind,
                          'practiceSquad': old['status'] == PRACTICE_SQUAD, 'note': note})
        elif old_on and new_on:
            old_team, new_team = normalize_team(old['team']), normalize_team(new['team'])
            if old_team != new_team:
                squad = new['status'] == PRACTICE_SQUAD
                where = 'practice squad ' if squad else ''
                moves.append({**base, 'team': new_team, 'fromTeam': old_team, 'type': 'joined',
                              'practiceSquad': squad, 'note': f'Joined {where}from {old_team}'})
            else:
                note = status_note(old['status'], new['status'])
                if note:
                    moves.append({**base, 'team': new_team, 'fromTeam': None, 'type': 'status',
                                  'practiceSquad': False, 'note': note})

    moves.sort(key=lambda m: (m['practiceSquad'], TYPE_ORDER[m['type']], m['team'], m['player']))
    return week, previous, moves


def build_injuries(rows: list[dict], week: int | None) -> list[dict]:
    injuries = [
        {
            'playerId': r['gsis_id'],
            'player': r['full_name'],
            'team': normalize_team(r['team']),
            'position': r['position'],
            'status': r['report_status'],
            'injury': r['report_primary_injury'] or r['practice_primary_injury'],
            'practice': PRACTICE_LABELS.get(r['practice_status'], r['practice_status']),
        }
        for r in rows
        if week is not None and r['week'] == week
    ]
    injuries.sort(key=lambda i: (GAME_STATUS_ORDER.get(i['status'], len(GAME_STATUS_ORDER)), i['team'], i['player']))
    return injuries


def build_transactions(
    weekly_rows: list[dict],
    injury_rows: list[dict],
    season: int,
    ticker_week: int | None,
    updated: str,
    shares: dict[str, float] | None = None,
) -> dict:
    """Pure function to the TransactionsData shape in src/data/types.ts.

    ticker_week is the week the ticker shows (None in the offseason), which
    picks the injury report and switches the whole file off in the
    offseason, when last season's final moves would read as news.
    """
    categories = [{'key': key, 'label': label} for key, label in CATEGORIES]
    if ticker_week is None:
        return {'season': season, 'week': None, 'movesWeek': None, 'comparedToWeek': None,
                'updated': updated, 'categories': categories, 'moves': [], 'injuries': []}
    moves_week, compared_to, moves = diff_rosters(weekly_rows)
    injuries = build_injuries(injury_rows, ticker_week)
    for move in moves:
        move['category'] = move_category(move)
    for entry in injuries:
        entry['category'] = 'game-status' if entry['status'] in GAME_STATUS_ORDER else 'practice-report'
    rank_items(moves + injuries, shares or {})
    return {
        'season': season,
        'week': ticker_week,
        'movesWeek': moves_week,
        'comparedToWeek': compared_to,
        'updated': updated,
        'categories': categories,
        'moves': moves,
        'injuries': injuries,
    }


def _load(loader, season: int, columns: list[str]) -> list[dict]:
    try:
        frame = loader(season)
    except ConnectionError as error:
        if missing_season(error):
            return []
        raise
    return frame.select(columns).to_dicts()


def load_weekly_roster_rows(season: int) -> list[dict]:
    import nflreadpy as nfl

    return _load(nfl.load_rosters_weekly, season, WEEKLY_COLUMNS)


def load_injury_rows(season: int) -> list[dict]:
    import nflreadpy as nfl

    return _load(nfl.load_injuries, season, INJURY_COLUMNS)


def load_snap_shares(season: int) -> dict[str, float]:
    """Snap shares from this season and last, keyed by gsis id.

    Snap counts are keyed by Pro Football Reference id; nflverse's player
    table maps those to gsis ids for every player, rostered or not.
    """
    import nflreadpy as nfl
    import polars as pl

    rows = []
    for year in (season - 1, season):
        try:
            frame = nfl.load_snap_counts(year)
        except ConnectionError as error:
            if missing_season(error):
                continue
            raise
        rows += frame.filter(pl.col('game_type') == 'REG').select(SNAP_COLUMNS).to_dicts()
    players = nfl.load_players().select('pfr_id', 'gsis_id').drop_nulls()
    return snap_shares(rows, dict(zip(players['pfr_id'], players['gsis_id'])))
