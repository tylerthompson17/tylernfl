"""Build src/data/rosters/{TEAM}.json from nflverse rosters.

One file per team so the daily job rewrites only the rosters that actually
moved, which keeps the committed diff readable.

nflverse publishes one row per player per season, with `week` recording the
snapshot that row came from. Only the latest week is a current roster: rows
left behind at an earlier week are players the newest snapshot dropped.
A player who is briefly missing from a snapshot disappears for a day and
comes back on the next run.

Status labels follow the nflverse roster status dictionary:
https://github.com/nflverse/nflreadr/blob/main/data-raw/dictionary_roster_status.csv
It describes only the coarse `status` codes. The finer
status_description_abbr codes (R01, P06, R48) have no documented meaning:
nflverse declined to document them (nflreadr issue #232), so they are not
decoded, and a player on injured reserve reads as "Reserve".
"""

from collections import Counter
from datetime import date

from common import missing_season, normalize_team, player_slug

# The displayed position comes from depth_chart_position (CB, G, T) rather
# than the coarse position column (DB, OL). Each group lists its positions
# in the order a depth chart reads, not alphabetically.
POSITION_GROUPS = [
    ('offense', 'Offense', ['QB', 'RB', 'FB', 'WR', 'TE', 'T', 'G', 'C', 'OL']),
    ('defense', 'Defense', ['DE', 'DT', 'NT', 'DL', 'OLB', 'LB', 'ILB', 'MLB', 'CB', 'S', 'FS', 'SS', 'DB']),
    ('specialists', 'Specialists', ['K', 'P', 'LS']),
]
# A position nflverse adds later lands here instead of being filed wrongly.
OTHER_GROUP = ('other', 'Other')

# Statuses that put a player on a team's roster, labeled from the
# dictionary's descriptions. RSN is described there as "tends to indicate"
# the non-football injury list, so it gets the plain reserve label.
STATUS_LABELS = {
    'ACT': 'Active',
    'RES': 'Reserve',
    'RSN': 'Reserve',
    'PUP': 'PUP list',
    'DEV': 'Practice squad',
    'E14': 'International exempt',
    'EXE': 'Commissioner exempt',
    'SUS': 'Suspended',
    'INA': 'Inactive',
}
# Statuses the dictionary describes as off the roster: cut, waived,
# released, retired, or free agents. TRL is undetermined even there.
LEFT_STATUSES = {'CUT', 'NWT', 'RET', 'RFA', 'RSR', 'TRC', 'TRD', 'TRL', 'TRT', 'UFA'}

GROUP_ORDER = {key: i for i, (key, _, _) in enumerate(POSITION_GROUPS)}
GROUP_ORDER[OTHER_GROUP[0]] = len(POSITION_GROUPS)
GROUP_LABELS = {key: label for key, label, _ in POSITION_GROUPS}
GROUP_LABELS[OTHER_GROUP[0]] = OTHER_GROUP[1]
POSITION_GROUP = {pos: key for key, _, positions in POSITION_GROUPS for pos in positions}
POSITION_ORDER = {pos: i for _, _, positions in POSITION_GROUPS for i, pos in enumerate(positions)}

ROSTER_COLUMNS = [
    'season', 'week', 'team', 'status', 'full_name', 'gsis_id', 'position',
    'depth_chart_position', 'jersey_number', 'birth_date', 'height', 'weight',
    'college', 'years_exp',
]


def age_on(birth_date: date | None, today: date) -> int | None:
    if birth_date is None:
        return None
    had_birthday = (today.month, today.day) >= (birth_date.month, birth_date.day)
    return today.year - birth_date.year - (0 if had_birthday else 1)


def assign_slugs(rows: list[dict]) -> list[str]:
    """One slug per row, in order, unique across the league.

    Players who share a name take a team suffix so each has a page of its
    own; the site turns the bare slug into a disambiguation page. Two
    players with the same name on the same team fall back to a counter.
    """
    base = [player_slug(r['full_name']) for r in rows]
    shared = {slug for slug, count in Counter(base).items() if count > 1}

    slugs = []
    used: Counter[str] = Counter()
    for slug, row in zip(base, rows):
        if slug in shared:
            slug = f"{slug}-{normalize_team(row['team']).lower()}"
        used[slug] += 1
        slugs.append(slug if used[slug] == 1 else f'{slug}-{used[slug]}')
    return slugs


def unknown_statuses(rows: list[dict]) -> set[str]:
    """Status codes the dictionary does not cover. Players with them are left
    off the roster, so the daily run reports them rather than hiding them."""
    return {r['status'] for r in rows} - set(STATUS_LABELS) - LEFT_STATUSES


def build_rosters(rows: list[dict], season: int, today: date, updated: str) -> dict[str, dict]:
    """Pure function from nflverse roster rows to TeamRoster files, keyed by team abbr."""
    week = max((r['week'] for r in rows), default=0)
    current = [r for r in rows if r['week'] == week and r['status'] in STATUS_LABELS]
    slugs = assign_slugs(current)

    by_team: dict[str, list[dict]] = {}
    for row, slug in zip(current, slugs):
        position = row['depth_chart_position'] or row['position']
        group = POSITION_GROUP.get(position, OTHER_GROUP[0])
        by_team.setdefault(normalize_team(row['team']), []).append(
            {
                'gsisId': row['gsis_id'],
                'name': row['full_name'],
                'slug': slug,
                'number': row['jersey_number'],
                'position': position,
                'group': group,
                'status': row['status'],
                'statusLabel': STATUS_LABELS[row['status']],
                'heightInches': row['height'],
                'weight': row['weight'],
                'age': age_on(row['birth_date'], today),
                'experience': row['years_exp'],
                'college': row['college'],
            }
        )

    rosters = {}
    for team, players in by_team.items():
        players.sort(
            key=lambda p: (
                GROUP_ORDER[p['group']],
                POSITION_ORDER.get(p['position'], len(POSITION_ORDER)),
                p['position'],
                # Unassigned numbers sort last rather than ahead of number 1.
                p['number'] is None,
                p['number'] or 0,
                p['name'],
            )
        )
        present = {p['group'] for p in players}
        rosters[team] = {
            'season': season,
            'team': team,
            'week': week,
            'updated': updated,
            'groups': [
                {'key': key, 'label': GROUP_LABELS[key]}
                for key in sorted(present, key=lambda k: GROUP_ORDER[k])
            ],
            'players': players,
        }
    return rosters


def load_roster_rows(season: int) -> list[dict]:
    import nflreadpy as nfl

    try:
        rosters = nfl.load_rosters(season)
    except ConnectionError as error:
        if missing_season(error):
            return []
        raise
    return rosters.select(ROSTER_COLUMNS).to_dicts()
