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
    weekly_rows: list[dict], injury_rows: list[dict], season: int, ticker_week: int | None, updated: str
) -> dict:
    """Pure function to the TransactionsData shape in src/data/types.ts.

    ticker_week is the week the ticker shows (None in the offseason), which
    picks the injury report and switches the whole file off in the
    offseason, when last season's final moves would read as news.
    """
    if ticker_week is None:
        return {'season': season, 'week': None, 'movesWeek': None, 'comparedToWeek': None,
                'updated': updated, 'moves': [], 'injuries': []}
    moves_week, compared_to, moves = diff_rosters(weekly_rows)
    return {
        'season': season,
        'week': ticker_week,
        'movesWeek': moves_week,
        'comparedToWeek': compared_to,
        'updated': updated,
        'moves': moves,
        'injuries': build_injuries(injury_rows, ticker_week),
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
