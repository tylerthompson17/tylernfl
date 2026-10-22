"""Draft order: writes src/data/draft_order.json, round 1 of the draft that
follows the ticker's season, as it would stand if the season ended today.
The rules are in docs/methods/draft-order.md; checked against the league's
2026 order in pipelines/test_draft_order.py.

The order (the NFL's rules for the selection meeting):
- Teams that missed the playoffs pick first, then playoff teams by the
  round they went out in (wild card, divisional, conference, the Super Bowl
  loser, the champion last). Teams still alive pick after every team
  already out, so before the playoffs the 14 playoff teams of today's
  standings are one group, ordered by record like the rest. The real order
  of 19 to 32 depends on the playoffs; the page says so.
- Within a group: worst win percentage first (a tie is half a win), then
  lower strength of schedule first (standings.py's: opponents' win
  percentage over every game played).
- Teams still level: teams of one conference by the standings' division and
  conference tiebreakers, reversed (the team that would lose them picks
  first; standings.rank_tied). Teams of both conferences: each
  conference's would-be first pick, then between those two head-to-head,
  record in common games (at least 4), and strength of victory, the lower
  picking first. Once a team is placed, the rest start again.
- The steps after strength of victory read points (combined ranking in
  points scored and allowed, net points), which the standings port does not
  go to, so a tie left after it is a coin toss: in the current order shown
  as unresolved, in abbreviation order; the projected order draws it.

Who owns each pick comes from pipelines/inputs/round1_picks.json, kept by
hand with a source per entry. nflverse's trade data is not used for it (no
original team, no condition terms, no forfeitures, months behind); the
daily run only warns when it lists a round 1 trade the file does not have.
"""

import json
from collections import defaultdict
from pathlib import Path
from typing import Callable

import standings
from common import normalize_team

PICKS_FILE = Path(__file__).resolve().parent / 'inputs' / 'round1_picks.json'

# The group a team picks in, earliest first. A playoff team not yet out is
# 'alive', after everyone already out.
GROUPS = ('non_playoff', 'wild_card', 'divisional', 'conference', 'super_bowl', 'alive', 'champion')
EXIT_GROUP = {'WC': 'wild_card', 'DIV': 'divisional', 'CON': 'conference', 'SB': 'super_bowl'}


# ---------------------------------------------------------------- pick ownership


def load_picks(draft: int, teams: set[str], path: Path = PICKS_FILE) -> dict:
    """The file's entries for one draft, checked. Raises ValueError on an
    entry with no source, an unknown team, a pick listed twice, or a choice
    between picks its team does not hold."""
    data = json.loads(path.read_text())
    picks = [p for p in data.get('picks', []) if p['draft'] == draft]
    choices = [c for c in data.get('choices', []) if c['draft'] == draft]

    def check(entry: dict, names: list) -> None:
        source = entry.get('source') or ''
        if not source.startswith('https://'):
            raise ValueError(f'{path.name}: entry with no source: {entry}')
        for name in names:
            if name is not None and name not in teams:
                raise ValueError(f'{path.name}: unknown team {name!r}: {entry}')

    owners = {team: team for team in teams}
    seen = set()
    for p in picks:
        if p['status'] not in ('traded', 'forfeited'):
            raise ValueError(f"{path.name}: status must be traded or forfeited: {p}")
        if (p['status'] == 'forfeited') != (p.get('owner') is None):
            raise ValueError(f'{path.name}: a forfeited pick has no owner, a traded one has one: {p}')
        check(p, [p['original'], p.get('owner')])
        if p['original'] in seen:
            raise ValueError(f"{path.name}: {p['original']}'s {draft} pick is listed twice")
        seen.add(p['original'])
        owners[p['original']] = p.get('owner')
    for c in choices:
        check(c, [c['from'], c['to'], *c['between']])
        if c['takes'] not in ('earlier', 'later') or len(c['between']) != 2:
            raise ValueError(f'{path.name}: a choice takes the earlier or later of two picks: {c}')
        if any(owners[t] != c['from'] for t in c['between']):
            raise ValueError(f"{path.name}: {c['from']} does not hold both picks in {c}")
    return {'picks': picks, 'choices': choices}


def apply_picks(order: list[str], picks: dict) -> list[dict]:
    """Slots in order, forfeited picks dropped (later picks move up), each
    with its owner, and for a pick settled by a choice, the choice."""
    owners = {p['original']: p.get('owner') for p in picks['picks']}
    forfeited = {p['original'] for p in picks['picks'] if p['status'] == 'forfeited'}
    choice_of = {}
    for c in picks['choices']:
        a, b = sorted(c['between'], key=order.index)
        taken = a if c['takes'] == 'earlier' else b
        owners[taken] = c['to']
        owners[a if taken == b else b] = c['from']
        choice_of[a] = choice_of[b] = c
    slots = []
    for team in order:
        if team in forfeited:
            continue
        slot = {'team': team, 'owner': owners.get(team, team), 'choice': None}
        if team in choice_of:
            c = choice_of[team]
            slot['choice'] = {'between': c['between'], 'takes': c['takes'], 'to': c['to']}
        slots.append(slot)
    return slots


def unlisted_trades(trade_rows: list[dict], picks_path: Path = PICKS_FILE, draft: int | None = None) -> list[str]:
    """nflverse trades of a round 1 pick in `draft` (every draft in the file
    when None) that the picks file has no entry for, as lines to log. An
    entry covers a trade when its giving and receiving teams match: a
    pick's original team and owner, or a choice's from and to."""
    data = json.loads(picks_path.read_text())
    covered = {(p['draft'], p['original'], p.get('owner')) for p in data.get('picks', [])}
    covered |= {(c['draft'], c['from'], c['to']) for c in data.get('choices', [])}
    drafts = {draft} if draft else {e['draft'] for e in data.get('picks', []) + data.get('choices', [])}
    missing = []
    for r in trade_rows:
        if r.get('pick_round') != 1 or r.get('pick_season') not in drafts:
            continue
        gave, received = normalize_team(r['gave']), normalize_team(r['received'])
        if (r['pick_season'], gave, received) in covered:
            continue
        conditional = ' (conditional)' if r.get('conditional') == 1 else ''
        missing.append(f"{r['pick_season']} round 1 pick, {gave} to {received}, traded {r['trade_date']}"
                       f"{conditional}, trade {r['trade_id']}")
    return missing


def load_trade_rows() -> list[dict]:
    import nflreadpy as nfl

    return nfl.load_trades().to_dicts()


# ---------------------------------------------------------------- the order


def playoff_exits(games: list[dict]) -> dict[str, str]:
    """Group by team from completed playoff games: the round a team lost in,
    or 'champion'."""
    exits = {}
    for g in games:
        kind = g.get('game_type')
        if kind not in EXIT_GROUP or g.get('home_score') is None or g.get('away_score') is None:
            continue
        away, home = normalize_team(g['away_team']), normalize_team(g['home_team'])
        winner, loser = (home, away) if g['home_score'] > g['away_score'] else (away, home)
        exits[loser] = EXIT_GROUP[kind]
        if kind == 'SB':
            exits[winner] = 'champion'
    return exits


def group_of(row: dict, exits: dict[str, str]) -> str:
    if row['conf_rank'] > 7:
        return 'non_playoff'
    return exits.get(row['team'], 'alive')


def _label(row: dict) -> str | None:
    """The step that placed a row of standings.rank_tied, as a site key."""
    label = row['conf_broken_by']
    if label == 'Division Tiebreaker':
        label = row['div_broken_by']
    return standings.step_key(label)


class _Reversed:
    """A toss key that sorts the other way round."""

    def __init__(self, key):
        self.key = key

    def __lt__(self, other):
        return other.key < self.key

    def __eq__(self, other):
        return self.key == other.key

    def __hash__(self):
        return hash(self.key)


def _conference_first(table: dict, h2h: dict, teams: list[str], toss_key) -> tuple[str, str | None]:
    """The team of one conference that picks first among `teams`: the one
    the standings' tiebreakers put last. The standings give a coin toss to
    the lowest toss key; reversed here, so the lowest key picks first, as
    between conferences."""
    if len(teams) == 1:
        return teams[0], None
    ranked = standings.rank_tied(table, h2h, teams, lambda r: _Reversed(toss_key(r)))
    last = ranked[-1]
    return last['team'], _label(last) or _label(ranked[-2])


def _pct(wins: float, games: float) -> float | None:
    return wins / games if games else None


def _interconference(table: dict, h2h: dict, a: str, b: str, toss_key) -> tuple[str, str]:
    """Which of two teams of different conferences picks first, and why."""
    pair = h2h.get((a, b))
    if pair and pair['games']:
        pa = pair['wins'] / pair['games']
        if pa != 0.5:
            return (a if pa < 0.5 else b), 'head_to_head'

    def opponents(team):
        return {opp for (t, opp) in h2h if t == team}

    common = (opponents(a) & opponents(b)) - {a, b}
    records = {}
    for team in (a, b):
        games = sum(h2h[(team, o)]['games'] for o in common)
        wins = sum(h2h[(team, o)]['wins'] for o in common)
        records[team] = (games, _pct(wins, games))
    if all(games >= 4 for games, _ in records.values()) and records[a][1] != records[b][1]:
        return (a if records[a][1] < records[b][1] else b), 'common_games'

    if table[a]['sov'] != table[b]['sov']:
        return (a if table[a]['sov'] < table[b]['sov'] else b), 'strength_of_victory'

    first = min((a, b), key=lambda t: toss_key(table[t]))
    return first, 'coin_toss'


def break_tie(table: dict, h2h: dict, teams: list[str], toss_key) -> list[tuple[str, str]]:
    """Teams level on record and strength of schedule, in pick order, each
    with the step that placed it. One team at a time: once one is placed
    the rest start again."""
    remaining = sorted(teams)
    placed = []
    step = None
    while len(remaining) > 1:
        by_conf = defaultdict(list)
        for t in remaining:
            by_conf[table[t]['conf']].append(t)
        firsts = {conf: _conference_first(table, h2h, group, toss_key) for conf, group in by_conf.items()}
        if len(firsts) == 1:
            team, step = next(iter(firsts.values()))
        else:
            (a, _), (b, _) = firsts['AFC'], firsts['NFC']
            team, step = _interconference(table, h2h, a, b, toss_key)
        placed.append((team, step))
        remaining.remove(team)
    placed.append((remaining[0], step))
    return placed


def order(table: dict, h2h: dict, exits: dict[str, str],
          toss_key: Callable[[dict], object] = standings.by_abbreviation) -> list[dict]:
    """Every team in pick order: team, group, and tiebreak (the step that
    placed it among teams on its record, None when alone on it)."""
    by_group = defaultdict(list)
    for row in table.values():
        by_group[group_of(row, exits)].append(row)
    result = []
    for group in GROUPS:
        level = defaultdict(list)
        for row in by_group[group]:
            level[row['win_pct']].append(row)
        for pct in sorted(level):
            rows = level[pct]
            by_sos = defaultdict(list)
            for row in rows:
                by_sos[row['sos']].append(row['team'])
            for sos in sorted(by_sos):
                teams = by_sos[sos]
                if len(teams) == 1:
                    step = 'strength_of_schedule' if len(rows) > 1 else None
                    result.append({'team': teams[0], 'group': group, 'tiebreak': step})
                    continue
                for team, step in break_tie(table, h2h, teams, toss_key):
                    result.append({'team': team, 'group': group, 'tiebreak': step})
    return result


# ---------------------------------------------------------------- the file


def build_draft_order(schedule_rows: list[dict], season: int, updated: str,
                      alignment: dict[str, tuple[str, str]] | None = None,
                      picks_path: Path = PICKS_FILE) -> dict:
    """The DraftOrderData shape in src/data/types.ts."""
    alignment = alignment or standings.load_alignment()
    draft = season + 1
    rows = [r for r in schedule_rows if r['season'] == season]
    regular = standings.completed_regular_season(rows, season)
    base = {'draft': draft, 'season': season, 'throughWeek': max((g['week'] for g in regular), default=0),
            'updated': updated}
    if not regular:
        return {**base, 'stage': 'not_started', 'picks': []}
    table, h2h = standings.records(regular, alignment)
    standings.division_ranks(table, h2h)
    standings.conference_ranks(table, h2h)
    exits = playoff_exits(rows)
    unplayed = [r for r in rows if r['game_type'] == 'REG' and r.get('home_score') is None]
    stage = 'final' if 'champion' in exits.values() else 'playoffs' if exits or not unplayed else 'regular_season'

    placed = order(table, h2h, exits)
    slots = apply_picks([p['team'] for p in placed], load_picks(draft, set(alignment), picks_path))
    by_team = {p['team']: p for p in placed}
    # A coin toss still to come, rather than one the league held: the
    # teams it would order are marked, and shown in abbreviation order.
    flips = {p['team'] for p in placed if p['tiebreak'] == 'coin_toss'}
    picks = []
    for number, slot in enumerate(slots, 1):
        row, placed_row = table[slot['team']], by_team[slot['team']]
        picks.append({
            'pick': number,
            'team': slot['team'],
            'owner': slot['owner'],
            'choice': slot['choice'],
            'group': placed_row['group'],
            'wins': row['true_wins'],
            'losses': row['losses'],
            'ties': row['ties'],
            'pct': round(row['win_pct'], 3),
            'sos': round(row['sos'], 3),
            'tiebreak': placed_row['tiebreak'],
            'coinFlip': slot['team'] in flips,
        })
    return {**base, 'stage': stage, 'picks': picks}
