"""NFL standings with tiebreakers: writes src/data/standings.json.

Built from completed regular season games in the nflverse schedule. The
tiebreakers are a port of nflseedR's (nfl_standings, version 2.0.2) at its
default depth: through strength of schedule, then a coin toss. The port is
literal, step for step, including its grouping and which teams each step
re-ranks, and it is checked against nflseedR's own output for every week
from 4 to 18 of 2022 to 2024 (pipelines/test_standings.py, fixtures in
tests/fixtures/standings/). Where nflseedR draws a coin toss at random,
this orders the tied teams by abbreviation and says it was a coin toss.

Records (as nflseedR computes them):
- A tie is half a win in every percentage.
- Division and conference records count only games against those teams.
- Head-to-head: games, wins (ties as half) and point differential per pair.
- Strength of victory: opponents' combined win percentage over the games a
  team won (0 with no wins). Strength of schedule: over every game played,
  so an opponent played twice counts twice.

Division ranks. Teams start ranked by win percentage in their division.
Ties are broken for groups of 4, then 3, then 2 tied teams, by head-to-head
win percentage among the tied teams, division record, record in common
games (opponents every tied team played), conference record, strength of
victory, strength of schedule. Each step re-ranks the whole tied group by
its value; a group it splits leaves smaller ties, which start again from
head-to-head in their own pass.

Conference seeds. Division winners take 1 to 4 by win percentage, everyone
else 5 to 16. Ties within one division follow the division order; for ties
across divisions, only the best-placed team from each division stays in
(the others drop a place), then for 4, 3, 2 tied teams: head-to-head sweep
(a team that beat, or lost to, every other tied team), conference record,
common games (at least 4), strength of victory, strength of schedule. Here
each step only settles who is first; everyone else drops a place and is
tied again next time round.
"""

import json
from collections import defaultdict
from pathlib import Path

from common import DATA_DIR, normalize_team

TEAMS_JSON = DATA_DIR / 'teams.json'

# Plain words for the step that separated a team, keyed as the site stores
# them; nflseedR's labels are mapped onto these.
STEP_KEYS = {
    'Head-To-Head Win PCT': 'head_to_head',
    'Head-To-Head Sweep': 'head_to_head_sweep',
    'Division Win PCT': 'division_record',
    'Common Games Win PCT': 'common_games',
    'Conference Win PCT': 'conference_record',
    'SOV': 'strength_of_victory',
    'SOS': 'strength_of_schedule',
    'Division Tiebreaker': 'division_order',
    'Coin Toss': 'coin_toss',
}


def load_alignment(path: Path = TEAMS_JSON) -> dict[str, tuple[str, str]]:
    """Team to (conference, division), from teams.json."""
    return {t['abbr']: (t['conference'], t['division']) for t in json.loads(path.read_text())}


# ---------------------------------------------------------------- records


def _outcome(result: float) -> float:
    return 1.0 if result > 0 else 0.0 if result < 0 else 0.5


def team_games(games: list[dict]) -> list[dict]:
    """Each completed regular season game twice, once from each side:
    team, opp, score, result (team's margin) and outcome (1, 0.5 or 0)."""
    rows = []
    for g in games:
        if g.get('game_type', 'REG') != 'REG' or g.get('home_score') is None or g.get('away_score') is None:
            continue
        away, home = normalize_team(g['away_team']), normalize_team(g['home_team'])
        margin = g['home_score'] - g['away_score']
        rows.append({'week': g['week'], 'team': away, 'opp': home, 'score': g['away_score'], 'result': -margin})
        rows.append({'week': g['week'], 'team': home, 'opp': away, 'score': g['home_score'], 'result': margin})
    for row in rows:
        row['outcome'] = _outcome(row['result'])
    return rows


def records(games: list[dict], alignment: dict[str, tuple[str, str]]) -> tuple[dict, dict]:
    """(standings rows by team, head-to-head by (team, opp))."""
    rows = team_games(games)
    by_team: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        by_team[row['team']].append(row)

    table = {}
    for team, (conf, division) in alignment.items():
        played = by_team.get(team, [])
        n = len(played)
        div_games = [r for r in played if alignment[r['opp']][1] == division]
        conf_games = [r for r in played if alignment[r['opp']][0] == conf]
        wins = sum(r['outcome'] for r in played)
        table[team] = {
            'team': team, 'conf': conf, 'division': division,
            'games': n,
            'wins': wins,
            'true_wins': sum(1 for r in played if r['outcome'] == 1),
            'losses': sum(1 for r in played if r['outcome'] == 0),
            'ties': sum(1 for r in played if r['outcome'] == 0.5),
            'pf': sum(r['score'] for r in played),
            'pa': sum(r['score'] - r['result'] for r in played),
            'win_pct': wins / n if n else 0.0,
            'div_pct': sum(r['outcome'] for r in div_games) / len(div_games) if div_games else 0.0,
            'conf_pct': sum(r['outcome'] for r in conf_games) / len(conf_games) if conf_games else 0.0,
            'div_record': _wlt(div_games),
            'conf_record': _wlt(conf_games),
            'streak': _streak(played),
        }

    for team, row in table.items():
        played = by_team.get(team, [])
        won = [r for r in played if r['outcome'] == 1]
        won_games = sum(table[r['opp']]['games'] for r in won)
        row['sov'] = sum(table[r['opp']]['wins'] for r in won) / won_games if won and won_games else 0.0
        all_games = sum(table[r['opp']]['games'] for r in played)
        row['sos'] = sum(table[r['opp']]['wins'] for r in played) / all_games if all_games else 0.0

    h2h: dict[tuple[str, str], dict] = {}
    for row in rows:
        entry = h2h.setdefault((row['team'], row['opp']), {'games': 0, 'wins': 0.0, 'pd': 0})
        entry['games'] += 1
        entry['wins'] += row['outcome']
        entry['pd'] += row['result']
    return table, h2h


def _wlt(rows: list[dict]) -> list[int]:
    return [sum(1 for r in rows if r['outcome'] == o) for o in (1, 0, 0.5)]


def _streak(played: list[dict]) -> str | None:
    """"W3", "L1", "T1": the run of identical results ending with the latest."""
    if not played:
        return None
    ordered = sorted(played, key=lambda r: r['week'])
    last = ordered[-1]['outcome']
    count = 0
    for row in reversed(ordered):
        if row['outcome'] != last:
            break
        count += 1
    return f"{'W' if last == 1 else 'L' if last == 0 else 'T'}{count}"


# ---------------------------------------------------------------- ranking helpers
#
# data.table's frank on the tied rows, with NA kept as NA ("keep").


def _rank_min(keys: list) -> list:
    return [None if k is None else 1 + sum(1 for o in keys if o is not None and o < k) for k in keys]


def _rank_max(keys: list) -> list:
    return [None if k is None else sum(1 for o in keys if o is not None and o <= k) for k in keys]


def _rank_dense(keys: list) -> list:
    distinct = sorted({k for k in keys if k is not None})
    return [None if k is None else 1 + distinct.index(k) for k in keys]


def _neg(value):
    return None if value is None else -value


# ---------------------------------------------------------------- division ranks


def _div_count(rows: list[dict]) -> None:
    counts = defaultdict(int)
    for r in rows:
        counts[(r['division'], r['div_rank'])] += 1
    for r in rows:
        r['div_counter'] = counts[(r['division'], r['div_rank'])]


def _div_rerank(rows: list[dict], n: int, value) -> None:
    """div_rank = min(div_rank) - 1 + frank(list(div_rank, -value), "min"),
    over the rows tied n ways, by division."""
    by_division = defaultdict(list)
    for r in rows:
        if r['div_counter'] == n:
            by_division[r['division']].append(r)
    for group in by_division.values():
        low = min(r['div_rank'] for r in group)
        ranks = _rank_min([(r['div_rank'], -value(r)) for r in group])
        for r, rank in zip(group, ranks):
            r['div_rank'] = low - 1 + rank


def _div_step_pct(rows: list[dict], n: int, key: str, label: str) -> None:
    tied = [r for r in rows if r['div_counter'] == n]
    _div_rerank(rows, n, lambda r: r[key])
    for r in tied:
        r['div_broken_by'] = f'{label} ({n})'
    _div_count(rows)
    for r in rows:
        if r['div_counter'] > 1:
            r['div_broken_by'] = None


def _div_step_h2h(rows: list[dict], h2h: dict, n: int) -> None:
    tied = [r for r in rows if r['div_counter'] == n]
    values = {}
    for r in tied:
        games = wins = 0.0
        for o in tied:
            if o is r or o['division'] != r['division'] or o['div_rank'] != r['div_rank']:
                continue
            pair = h2h.get((r['team'], o['team']))
            if pair:
                games += pair['games']
                wins += pair['wins']
        values[r['team']] = wins / games if games else 0.0
    _div_rerank(rows, n, lambda r: values[r['team']])
    _div_count(rows)
    for r in tied:
        if r['div_counter'] == 1:
            r['div_broken_by'] = f'Head-To-Head Win PCT ({n})'


def _div_step_common(rows: list[dict], h2h: dict, n: int) -> None:
    tied = [r for r in rows if r['div_counter'] == n]
    opponents = defaultdict(set)  # (division, div_rank, opp) -> teams that played opp
    for r in tied:
        for (team, opp) in h2h:
            if team == r['team']:
                opponents[(r['division'], r['div_rank'], opp)].add(team)
    values = {}
    for r in tied:
        games = wins = 0.0
        for (team, opp), pair in h2h.items():
            if team != r['team']:
                continue
            if len(opponents[(r['division'], r['div_rank'], opp)]) == n:
                games += pair['games']
                wins += pair['wins']
        values[r['team']] = wins / games if games else 0.0
    _div_rerank(rows, n, lambda r: values[r['team']])
    _div_count(rows)
    for r in tied:
        if r['div_counter'] == 1:
            r['div_broken_by'] = f'Common Games Win PCT ({n})'


def division_ranks(table: dict, h2h: dict) -> None:
    """Sets div_rank (1 to 4) and div_broken_by on every row of `table`."""
    rows = list(table.values())
    by_division = defaultdict(list)
    for r in rows:
        r['div_broken_by'] = None
        by_division[r['division']].append(r)
    for group in by_division.values():
        for r, rank in zip(group, _rank_min([-g['win_pct'] for g in group])):
            r['div_rank'] = rank
    _div_count(rows)

    if any(r['div_counter'] > 1 for r in rows):
        for n in (4, 3, 2):
            steps = [
                lambda: _div_step_h2h(rows, h2h, n),
                lambda: _div_step_pct(rows, n, 'div_pct', 'Division Win PCT'),
                lambda: _div_step_common(rows, h2h, n),
                lambda: _div_step_pct(rows, n, 'conf_pct', 'Conference Win PCT'),
                lambda: _div_step_pct(rows, n, 'sov', 'SOV'),
                lambda: _div_step_pct(rows, n, 'sos', 'SOS'),
            ]
            for step in steps:
                if all(r['div_counter'] < n for r in rows):
                    break
                step()

        # Coin toss, drawn in nflseedR; here the tied teams go in
        # abbreviation order.
        tied = defaultdict(list)
        for r in rows:
            if r['div_counter'] > 1:
                tied[r['division']].append(r)
        for group in tied.values():
            low = min(r['div_rank'] for r in group)
            order = sorted(group, key=lambda r: (r['div_rank'], -r['win_pct'], r['team']))
            for i, r in enumerate(order):
                r['div_rank'] = low + i
                r['div_broken_by'] = 'Coin Toss'
    for r in rows:
        r.pop('div_counter', None)


# ---------------------------------------------------------------- conference ranks


def _conf_count(rows: list[dict]) -> None:
    counts = defaultdict(int)
    for r in rows:
        counts[(r['conf'], r['conf_rank'])] += 1
    for r in rows:
        r['conf_counter'] = counts[(r['conf'], r['conf_rank'])]


def _conf_by_division(rows: list[dict]) -> None:
    """A tie among teams of one division follows the division order."""
    groups = defaultdict(list)
    for r in rows:
        if r['conf_counter'] is not None and r['conf_counter'] > 1:
            groups[(r['conf'], r['conf_rank'])].append(r)
    for group in groups.values():
        if len({r['division'] for r in group}) != 1:
            continue
        for r, rank in zip(group, _rank_min([r['div_rank'] for r in group])):
            r['conf_rank'] = r['conf_rank'] - 1 + rank
            r['conf_broken_by'] = 'Division Tiebreaker'
    _conf_count(rows)


def _conf_division_reduction(rows: list[dict]) -> None:
    """Only the best-placed team from each division stays in a tie; the
    others drop a place and sit out this round."""
    groups = defaultdict(list)
    for r in rows:
        if r['conf_counter'] is not None and r['conf_counter'] > 1:
            groups[(r['conf'], r['conf_rank'], r['division'])].append(r)
    reduced = []
    for group in groups.values():
        best = min(r['div_rank'] for r in group)
        reduced += [r for r in group if r['div_rank'] != best]
    for r in reduced:
        r['conf_rank'] += 1
    _conf_count(rows)
    for r in reduced:
        r['conf_counter'] = None


def _conf_settle_first(rows: list[dict], n: int, values: dict, label: str, eligible=None) -> None:
    """Among the rows tied n ways (grouped by the tie they started the
    round in), a unique best value takes the place; everyone below the best
    value drops a place and sits out the rest of the round."""
    tied = [r for r in rows if r['conf_counter'] == n and (eligible is None or eligible(r))]
    groups = defaultdict(list)
    for r in tied:
        groups[r['tied_for']].append(r)
    for group in groups.values():
        keys = [_neg(values.get(r['team'])) for r in group]
        top = _rank_max(keys)
        dense = _rank_dense(keys)
        for r, t, d in zip(group, top, dense):
            if d is not None and d != 1:
                r['conf_counter'] = None
                r['conf_rank'] += 1
            if t == 1:
                r['conf_counter'] = 1
                r['conf_broken_by'] = f'{label} ({n})'
    still = [r for r in rows if r['conf_counter'] == n]
    counts = defaultdict(int)
    for r in still:
        counts[(r['conf'], r['conf_rank'])] += 1
    for r in still:
        r['conf_counter'] = counts[(r['conf'], r['conf_rank'])]


def _conf_step_h2h(rows: list[dict], h2h: dict, n: int) -> None:
    tied = [r for r in rows if r['conf_counter'] == n]
    values = {}
    for r in tied:
        others = [o for o in tied if o is not r and o['conf'] == r['conf'] and o['conf_rank'] == r['conf_rank']]
        if not others:
            continue  # no pairs: no value at all
        games = wins = 0.0
        missing = False
        for o in others:
            pair = h2h.get((r['team'], o['team']))
            if pair is None:
                missing = True
                continue
            games += pair['games']
            wins += pair['wins']
        sweep = None if missing or not games else wins / games
        if sweep is not None and 0 < sweep < 1:
            sweep = None
        values[r['team']] = 0.5 if sweep is None else sweep
    _conf_settle_first(rows, n, values, 'Head-To-Head Sweep')


def _conf_step_common(rows: list[dict], h2h: dict, n: int) -> None:
    tied = [r for r in rows if r['conf_counter'] == n]
    opponents = defaultdict(set)
    for r in tied:
        for (team, opp) in h2h:
            if team == r['team']:
                opponents[(r['conf'], r['conf_rank'], opp)].add(team)
    values, games_by = {}, {}
    for r in tied:
        games = wins = 0.0
        for (team, opp), pair in h2h.items():
            if team != r['team']:
                continue
            if len(opponents[(r['conf'], r['conf_rank'], opp)]) == n:
                games += pair['games']
                wins += pair['wins']
        values[r['team']] = wins / games if games else 0.0
        games_by[r['team']] = games
    _conf_settle_first(rows, n, values, 'Common Games Win PCT',
                       eligible=lambda r: games_by.get(r['team'], 0) >= 4)


def _conf_step_value(rows: list[dict], n: int, key: str, label: str) -> None:
    values = {r['team']: r[key] for r in rows if r['conf_counter'] == n}
    _conf_settle_first(rows, n, values, label)


def conference_ranks(table: dict, h2h: dict) -> None:
    """Sets conf_rank (1 to 16) and conf_broken_by on every row. Needs
    division_ranks first."""
    rows = list(table.values())
    for r in rows:
        r['conf_broken_by'] = None
        r['tied_for'] = None
    for conf in ('AFC', 'NFC'):
        winners = [r for r in rows if r['conf'] == conf and r['div_rank'] == 1]
        others = [r for r in rows if r['conf'] == conf and r['div_rank'] != 1]
        for r, rank in zip(winners, _rank_min([-w['win_pct'] for w in winners])):
            r['conf_rank'] = rank
        for r, rank in zip(others, _rank_min([-o['win_pct'] for o in others])):
            r['conf_rank'] = 4 + rank
    _conf_count(rows)

    if any(r['conf_counter'] > 1 for r in rows):
        _conf_by_division(rows)
        rounds = 0
        while any(r['conf_counter'] is not None and r['conf_counter'] > 1 for r in rows):
            rounds += 1
            if rounds > 12:
                # nflseedR stops with an error here; settle what is left by
                # coin toss so a live season always has standings.
                _conf_coin_toss(rows, None)
                break
            for r in rows:
                if r['conf_counter'] is not None and r['conf_counter'] > 1:
                    r['tied_for'] = (r['conf'], r['conf_rank'], r['conf_counter'])
            _conf_division_reduction(rows)
            for n in (4, 3, 2):
                steps = [
                    lambda: _conf_step_h2h(rows, h2h, n),
                    lambda: _conf_step_value(rows, n, 'conf_pct', 'Conference Win PCT'),
                    lambda: _conf_step_common(rows, h2h, n),
                    lambda: _conf_step_value(rows, n, 'sov', 'SOV'),
                    lambda: _conf_step_value(rows, n, 'sos', 'SOS'),
                    lambda: _conf_coin_toss(rows, n),
                ]
                for step in steps:
                    if all(r['conf_counter'] is None or r['conf_counter'] < n for r in rows):
                        break
                    step()
            _conf_count(rows)
            _conf_by_division(rows)
            for r in rows:
                r['tied_for'] = None
    for r in rows:
        r.pop('conf_counter', None)
        r.pop('tied_for', None)


def _conf_coin_toss(rows: list[dict], n: int | None) -> None:
    """nflseedR draws these at random: conf_rank - 1 + frank(list(conf_rank,
    -win_pct), "random") within each tie. Here the tied teams go in
    abbreviation order. With n None, every tie left (the fallback when the
    rounds run out)."""
    groups = defaultdict(list)
    for r in rows:
        counter = r['conf_counter']
        if counter is None or (counter != n if n else counter <= 1):
            continue
        groups[r['tied_for'] if n else (r['conf'], r['conf_rank'])].append(r)
    for group in groups.values():
        keys = [(r['conf_rank'], -r['win_pct'], r['team']) for r in group]
        for r, rank in zip(group, _rank_min(keys)):
            r['conf_rank'] = r['conf_rank'] - 1 + rank
            r['conf_broken_by'] = 'Coin Toss'


def compute(games: list[dict], alignment: dict[str, tuple[str, str]]) -> dict:
    """Standings rows by team, ranked, from completed games."""
    table, h2h = records(games, alignment)
    division_ranks(table, h2h)
    conference_ranks(table, h2h)
    return table


# ---------------------------------------------------------------- the file


def step_key(label: str | None) -> str | None:
    """nflseedR's label ("Head-To-Head Win PCT (2)") as the site's key."""
    if not label:
        return None
    return STEP_KEYS.get(label.split(' (')[0])


def completed_regular_season(schedule_rows: list[dict], season: int) -> list[dict]:
    return [
        r for r in schedule_rows
        if r['season'] == season and r['game_type'] == 'REG'
        and r.get('away_score') is not None and r.get('home_score') is not None
    ]


def build_standings(schedule_rows: list[dict], season: int, updated: str,
                    alignment: dict[str, tuple[str, str]] | None = None) -> dict:
    """standings.json. Before the season's first game, last season's final
    standings, so the page never shows 32 teams at 0-0."""
    alignment = alignment or load_alignment()
    games = completed_regular_season(schedule_rows, season)
    if not games:
        season -= 1
        games = completed_regular_season(schedule_rows, season)
    table = compute(games, alignment)
    rows = sorted(table.values(), key=lambda r: (r['conf'], r['division'], r['div_rank']))
    return {
        'season': season,
        'throughWeek': max((g['week'] for g in games), default=0),
        'updated': updated,
        'teams': [
            {
                'team': r['team'],
                'conference': r['conf'],
                'division': r['division'],
                'wins': r['true_wins'],
                'losses': r['losses'],
                'ties': r['ties'],
                'pct': round(r['win_pct'], 3),
                'pointsFor': int(r['pf']),
                'pointsAgainst': int(r['pa']),
                'diff': int(r['pf'] - r['pa']),
                'divisionRecord': r['div_record'],
                'conferenceRecord': r['conf_record'],
                'streak': r['streak'],
                'divisionRank': r['div_rank'],
                'conferenceRank': r['conf_rank'],
                'divisionTiebreak': step_key(r['div_broken_by']),
                'conferenceTiebreak': step_key(r['conf_broken_by']),
            }
            for r in rows
        ],
    }
