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
  change a game people are partway through.
"""

import hashlib
import json
import re
from datetime import date

from common import DATA_DIR, write_json_if_changed

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


def build_daily_fourth(decisions: dict, day: date, previous: dict | None) -> dict:
    """The day's game, or the previous file unchanged when it is already for this date."""
    if previous and previous.get('date') == day.isoformat():
        return previous
    history = [h for h in (previous or {}).get('history', [])
               if 0 < (day - date.fromisoformat(h['date'])).days <= REUSE_DAYS]
    recent = {k for h in history for k in h['keys']}
    plays = [baked(r) for r in select(decisions['fourthDowns'], day, recent)]
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


def update_daily_fourth(decisions: dict, day: date) -> str:
    """Build and write the day's game; the line the daily run prints."""
    path = DATA_DIR / FILE
    previous = json.loads(path.read_text()) if path.exists() else None
    game = build_daily_fourth(decisions, day, previous)
    changed = write_json_if_changed(FILE, game)
    kinds = ', '.join(f"{p['offense']} {p['call']}{' (close)' if p['close'] else ''}"
                      f"{' against' if p['teamCall'] != p['call'] else ''}" for p in game['plays'])
    return f"daily 4th down game: {game['date']} #{game['number']}, {kinds or 'no plays'}{', updated' if changed else ''}"
