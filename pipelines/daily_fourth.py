"""The daily 4th down game (/fourth-down/daily/): five real 4th downs of the
season, the same for everyone on a date, written to src/data/daily_fourth.json
with everything the page shows baked in (each option's win probability,
nfl4th's call and margin, what the team did and what happened), so the page
downloads no model and fetches nothing.

Read only from decisions.json, the same morning's file. Selection:
- The pool is every 4th down nfl4th evaluated (skip is null: not overtime,
  the last 15 seconds or a game already decided) with every option's WP and
  a margin, in a game still in doubt (nfl4th's best option between 5% and
  95%). Fakes are left out: what the team did is neither choice.
- Each play is ranked by sha256 of the date and its key, so a date always
  gives the same order and nothing reads a clock or Python's random. Plays
  used in the last REUSE_DAYS days' games rank after every unused one.
- Five slots are filled in rank order: AGAINST plays where the coach went
  against nfl4th (margin at least CLOSE), then one close call (margin under
  CLOSE) on days the date's hash says so, then the rest from plays with a
  margin of CLOSE or more. Close calls are never used anywhere else.
- Every pick keeps the day varied: no team twice (on offense or defense),
  no game twice, at most 2 of one nfl4th call, of one field zone and of one
  quarter, and at most 1 routine punt. When the pool cannot satisfy them
  they are dropped one at a time in RELAX order; distinct games never are.
- A date already in the file is kept as it is, so the game day reruns never
  change a game people are partway through. The one exception is a field
  added later (what happened next, below): a kept day's plays get it
  filled in, and nothing else about them changes.

What happened next (`next` on each play) is read from nflverse play-by-play
(through pbp_cache.py), not from decisions.json. Possessions are nflfastR's
`fixed_drive`, with its `fixed_drive_result`; each possession's plays, net
yards and starting spot are nflverse's own drive fields (`drive_play_count`,
`ydsnet`, `drive_start_yard_line`), summed over the NFL drives inside it
(about 1 in 200 possessions spans two). After a punt, a field goal or a
failed attempt it is the next possession; after a conversion, the offense's
own drive. A possession that starts after halftime (or in overtime) is not
the next one: the half ended first. A touchdown the defense scored on the
play itself has no next possession.
"""

import hashlib
import json
import re
from collections.abc import Callable
from datetime import date

from common import DATA_DIR, normalize_team, write_json_if_changed

FILE = 'daily_fourth.json'
PLAYS = 5
# Under this gap between nfl4th's top two options a play is a close call,
# the live items' CLOSE (src/lib/live-fourth/words.ts).
CLOSE = 0.02
AGAINST = 2
REUSE_DAYS = 21
# A game still in doubt: the best option's WP inside this range.
IN_DOUBT = (0.05, 0.95)
# The first day of the game: puzzle number 1.
FIRST_DAY = date(2026, 10, 25)
CALLS = ('go', 'punt', 'field goal')
WP_FIELDS = {'go': 'wpGo', 'punt': 'wpPunt', 'field goal': 'wpFieldGoal'}
# Constraints in the order they are dropped when the pool runs short.
RELAX = ('routine punt', 'quarter', 'zone', 'call', 'team')
# nflfastR's fixed_drive_result as the page words it.
RESULTS = {
    'Touchdown': 'touchdown',
    'Field goal': 'field goal',
    'Missed field goal': 'missed field goal',
    'Punt': 'punt',
    'Turnover': 'turnover',
    'Turnover on downs': 'turnover on downs',
    'Opp touchdown': 'opponent touchdown',
    'Safety': 'safety',
    'End of half': 'end of half',
}
# Play-by-play columns what happened next reads.
NEXT_COLUMNS = [
    'game_id', 'play_id', 'qtr', 'posteam', 'play_type', 'fixed_drive', 'fixed_drive_result', 'drive', 'drive_play_count',
    'ydsnet', 'drive_start_yard_line', 'fourth_down_converted', 'home_score', 'away_score',
]


def rank(day: date, key: str) -> str:
    return hashlib.sha256(f'{day.isoformat()}:{key}'.encode()).hexdigest()


def play_key(r: dict) -> str:
    return f"{r['gameId']}:{r['playId']}"


def eligible(r: dict) -> bool:
    if not (r['skip'] is None and r['call'] in CALLS and r.get('margin') is not None
            and r.get('wpGo') is not None and r.get('wpCost') is not None and not r['fake']):
        return False
    return IN_DOUBT[0] <= r[WP_FIELDS[r['call']]] <= IN_DOUBT[1]


def quarter_clock(s: dict) -> tuple[int, int]:
    """Quarter and seconds on its clock, from the half's seconds left."""
    half = s['halfSecondsRemaining']
    first_half = s['secondsRemaining'] > 1800
    if half > 900:
        return (1 if first_half else 3), half - 900
    return (2 if first_half else 4), half


def zone(s: dict) -> str:
    y = s['yardline100']
    return 'own side' if y > 50 else 'midfield' if y >= 35 else 'scoring range'


def routine_punt(r: dict) -> bool:
    s = r['situation']
    return r['call'] == 'punt' and r['teamCall'] == 'punt' and s['yardline100'] > 50 and s['distance'] >= 5


def against(r: dict) -> bool:
    return r['teamCall'] != r['call']


def fits(r: dict, picked: list[dict], dropped: set[str]) -> bool:
    s = r['situation']
    if any(p['gameId'] == r['gameId'] for p in picked):
        return False
    if 'team' not in dropped:
        teams = {t for p in picked for t in (p['situation']['posteam'], p['situation']['defteam'])}
        if s['posteam'] in teams or s['defteam'] in teams:
            return False
    checks = {
        'call': lambda p: p['call'] == r['call'],
        'zone': lambda p: zone(p['situation']) == zone(s),
        'quarter': lambda p: quarter_clock(p['situation'])[0] == quarter_clock(s)[0],
    }
    for name, same in checks.items():
        if name not in dropped and sum(map(same, picked)) >= 2:
            return False
    return 'routine punt' in dropped or not (routine_punt(r) and any(map(routine_punt, picked)))


def take(candidates: list[dict], picked: list[dict], count: int) -> None:
    """Add up to count of candidates to picked, in order, relaxing the
    variety rules one at a time only when nothing fits."""
    for _ in range(count):
        for i in range(len(RELAX) + 1):
            dropped = set(RELAX[:i])
            found = next((r for r in candidates if r not in picked and fits(r, picked, dropped)), None)
            if found:
                picked.append(found)
                break


def select(fourth_downs: list[dict], day: date, recent: set[str]) -> list[dict]:
    """The day's five 4th downs, in the order they are played."""
    pool = sorted((r for r in fourth_downs if eligible(r)),
                  key=lambda r: (play_key(r) in recent, rank(day, play_key(r))))
    clear = [r for r in pool if r['margin'] >= CLOSE]
    close = [r for r in pool if r['margin'] < CLOSE]
    picked: list[dict] = []
    take([r for r in clear if against(r)], picked, AGAINST)
    if int(rank(day, 'close call'), 16) % 2 == 0:
        take(close, picked, 1)
    take(clear, picked, PLAYS - len(picked))
    if len(picked) < PLAYS:
        return []
    return sorted(picked, key=lambda r: rank(day, 'order:' + play_key(r)))


def a_yards(n: int) -> str:
    return f"{'an' if n in (8, 11, 18) or 80 <= n <= 89 else 'a'} {n}-yard"


def plural(n: int) -> str:
    return f"{n} {'yard' if abs(n) == 1 else 'yards'}"


def play_summary(text: str, distance: int, call: str) -> str:
    """What happened, in a few plain words, from nflverse's play text: the
    same wording as the live items (playSummary in src/lib/live-fourth/words.ts)."""
    if call == 'punt':
        if re.search(r'blocked', text, re.I):
            return 'Punt blocked'
        m = re.search(r'punts (\d+) yards?', text, re.I)
        return f'Punted {m[1]} yards' if m else 'Punted'
    if call == 'field goal':
        m = re.search(r'(\d+) yard field goal', text, re.I)
        kick = f'{a_yards(int(m[1]))} field goal' if m else 'a field goal'
        if re.search(r'blocked', text, re.I):
            return f'{kick[0].upper()}{kick[1:]} blocked'
        return f'Made {kick}' if re.search(r'is good', text, re.I) else f'Missed {kick}'
    if re.search(r'intercepted', text, re.I):
        return 'Stopped: intercepted'
    if re.search(r'fumbles', text, re.I) and re.search(r'recovered by', text, re.I) and not re.search(r'touchdown', text, re.I):
        return 'Fumbled'
    how = 'pass' if re.search(r'\bpass\b', text, re.I) else 'run'
    if re.search(r'for no gain', text, re.I):
        yards = 0
    else:
        m = re.search(r'for (-?\d+) yards?', text, re.I)
        yards = int(m[1]) if m else None
    if re.search(r'sacked', text, re.I):
        return 'Stopped: sacked' + (f' for a loss of {plural(-yards)}' if yards is not None and yards < 0 else '')
    if re.search(r'incomplete', text, re.I):
        return 'Stopped: incomplete pass'
    if re.search(r'touchdown', text, re.I):
        return f"Touchdown on {f'{a_yards(yards)} ' if yards is not None else 'a '}{how}"
    if yards is None:
        return 'Went for it'
    if yards >= distance:
        return f'Converted with {a_yards(yards)} {how}'
    short = (f'{a_yards(yards)} {how}' if yards > 0 else f'no gain on a {how}' if yards == 0
             else f'a loss of {plural(-yards)} on a {how}')
    return f'Stopped: {short}, short of the line'


def baked(r: dict) -> dict:
    """One play as the page shows it."""
    s = r['situation']
    quarter, clock = quarter_clock(s)
    away = s['defteam'] if s['home'] == s['posteam'] else s['posteam']
    return {
        'key': play_key(r),
        'gameId': r['gameId'],
        'week': r['week'],
        'away': away,
        'home': s['home'],
        'offense': s['posteam'],
        'defense': s['defteam'],
        'coach': r['coach'],
        'quarter': quarter,
        'clock': clock,
        'distance': s['distance'],
        'yardline100': s['yardline100'],
        'scoreDiff': s['scoreDiff'],
        'timeoutsOffense': s['timeoutsOffense'],
        'timeoutsDefense': s['timeoutsDefense'],
        'wp': {call: r.get(WP_FIELDS[call]) for call in CALLS},
        'call': r['call'],
        'margin': r['margin'],
        'close': r['margin'] < CLOSE,
        'teamCall': r['teamCall'],
        'coachWpLost': r['wpCost'],
        'result': play_summary(r['description'], s['distance'], r['teamCall']),
        'description': r['description'],
    }


def half(qtr: int) -> int:
    """1 or 2 for regulation, 3 for overtime."""
    return 1 if qtr <= 2 else 2 if qtr <= 4 else 3


def spot(text: str | None, team: str) -> int | None:
    """nflverse's "KC 16" or "50" as yards from the opponent's goal line for team."""
    if not text:
        return None
    parts = text.split()
    if len(parts) == 1:
        return int(parts[0])
    side, yards = normalize_team(parts[0]), int(parts[1])
    return 100 - yards if side == team else yards


def possessions(rows: list[dict]) -> dict[int, dict]:
    """Every possession of one game by fixed_drive: team, start, plays,
    yards, result and the quarters it ran in."""
    by: dict[int, list[dict]] = {}
    for r in rows:
        # Marker rows (END GAME and the like) have no play_type but can carry a posteam.
        if r['fixed_drive'] is not None and r['posteam'] and r['play_type'] is not None:
            by.setdefault(int(r['fixed_drive']), []).append(r)
    out = {}
    for n, plays in by.items():
        plays.sort(key=lambda r: r['play_id'])
        teams = [normalize_team(r['posteam']) for r in plays]
        team = max(set(teams), key=teams.count)
        drives: dict[float, dict] = {}
        for r in plays:
            if r['drive'] is not None and r['drive'] not in drives:
                drives[r['drive']] = r
        firsts = [drives[d] for d in sorted(drives)]
        # The NFL counts a kickoff as a drive of its own, with no start spot.
        starts = [r['drive_start_yard_line'] for r in firsts if r['drive_start_yard_line']]
        quarters = [int(r['qtr']) for r in plays if r['qtr'] is not None]
        out[n] = {
            'team': team,
            'startYardline100': spot(starts[0], team) if starts else None,
            'plays': sum(int(r['drive_play_count'] or 0) for r in firsts),
            'yards': sum(int(r['ydsnet'] or 0) for r in firsts),
            'result': plays[-1]['fixed_drive_result'],
            'firstQuarter': min(quarters),
            'lastQuarter': max(quarters),
        }
    return out


def drive_words(p: dict, later: bool) -> dict:
    """A possession as the page reads it, with the result in its words."""
    result = RESULTS.get(p['result'])
    if result == 'end of half' and p['lastQuarter'] >= 4:
        result = 'end of regulation' if later else 'end of game'
    return {'team': p['team'], 'startYardline100': p['startYardline100'], 'plays': p['plays'],
            'yards': p['yards'], 'result': result}


def what_next(rows: list[dict], play_id: int, team_call: str) -> dict | None:
    """What followed one 4th down, from its game's play-by-play rows: the
    offense's drive after a conversion, else the next possession, and the
    final score. None when the play is not in the rows."""
    play = next((r for r in rows if int(r['play_id']) == play_id), None)
    if play is None or play['fixed_drive'] is None:
        return None
    drives = possessions(rows)
    this = int(play['fixed_drive'])
    later = sorted(n for n in drives if n > this)
    final = {
        'away': int(play['away_score']),
        'home': int(play['home_score']),
        'overtime': any((r['qtr'] or 0) >= 5 for r in rows),
    }
    converted = team_call == 'go' and play['fourth_down_converted'] == 1
    drive, ended = None, None
    if converted:
        drive = drive_words(drives[this], bool(later))
    elif drives[this]['result'] == 'Opp touchdown':
        ended = 'touchdown'
    elif not later:
        ended = 'game'
    elif half(drives[later[0]]['firstQuarter']) != half(int(play['qtr'])):
        ended = 'half' if half(int(play['qtr'])) == 1 else 'regulation'
    else:
        drive = drive_words(drives[later[0]], len(later) > 1)
    return {'converted': converted, 'drive': drive, 'ended': ended, 'final': final}


def load_next_rows(season: int, current_season: int, game_ids: set[str]) -> dict[str, list[dict]]:
    """Play-by-play rows of the given games, by game, for what_next."""
    import polars as pl

    from pbp_cache import load_pbp

    pbp = load_pbp(season, current_season)
    if pbp is None or not game_ids:
        return {}
    rows = pbp.filter(pl.col('game_id').is_in(list(game_ids))).select(NEXT_COLUMNS).to_dicts()
    games: dict[str, list[dict]] = {}
    for r in rows:
        games.setdefault(r['game_id'], []).append(r)
    return games


Rows = Callable[[set[str]], dict[str, list[dict]]]


def with_next(play: dict, games: dict[str, list[dict]]) -> dict:
    rows = games.get(play['gameId'])
    if rows is None:
        return play | {'next': play.get('next')}
    return play | {'next': what_next(rows, int(play['key'].split(':')[1]), play['teamCall'])}


def build_daily_fourth(decisions: dict, day: date, previous: dict | None, rows_for: Rows | None = None) -> dict:
    """The day's game, or the previous file when it is already for this date:
    unchanged, except that plays without what happened next get it, when
    rows_for (game ids to their play-by-play rows) is given."""
    if previous and previous.get('date') == day.isoformat():
        missing = [p for p in previous['plays'] if p.get('next') is None]
        if rows_for is None or not missing:
            return previous
        games = rows_for({p['gameId'] for p in missing})
        return previous | {'plays': [p if p.get('next') is not None else with_next(p, games)
                                     for p in previous['plays']]}
    history = [h for h in (previous or {}).get('history', [])
               if 0 < (day - date.fromisoformat(h['date'])).days <= REUSE_DAYS]
    recent = {k for h in history for k in h['keys']}
    picked = select(decisions['fourthDowns'], day, recent)
    games = rows_for({r['gameId'] for r in picked}) if rows_for and picked else {}
    plays = [with_next(baked(r), games) for r in picked]
    if plays:
        history = [{'date': day.isoformat(), 'keys': [p['key'] for p in plays]}] + history
    return {
        'date': day.isoformat(),
        'number': (day - FIRST_DAY).days + 1,
        'season': decisions['season'],
        'modelVersion': decisions['modelVersion'],
        'closeMargin': CLOSE,
        'plays': plays,
        'coachWpLost': round(sum(p['coachWpLost'] for p in plays), 5),
        'history': history,
    }


def update_daily_fourth(decisions: dict, day: date, current_season: int) -> str:
    """Build and write the day's game; the line the daily run prints."""
    path = DATA_DIR / FILE
    previous = json.loads(path.read_text()) if path.exists() else None
    game = build_daily_fourth(decisions, day, previous,
                              lambda ids: load_next_rows(decisions['season'], current_season, ids))
    changed = write_json_if_changed(FILE, game)
    kinds = ', '.join(f"{p['offense']} {p['call']}{' (close)' if p['close'] else ''}"
                      f"{' against' if p['teamCall'] != p['call'] else ''}" for p in game['plays'])
    return f"daily 4th down game: {game['date']} #{game['number']}, {kinds or 'no plays'}{', updated' if changed else ''}"
