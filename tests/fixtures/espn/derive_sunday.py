"""Derives a week 2 Sunday scoreboard, mid-afternoon, from the real Thursday
capture, for the audit's Sunday date state (tests/fixtures/states/). Run by
hand from the repo root with the pipelines' Python (it reads nflverse
play-by-play through pipelines/pbp_cache.py):

    pipelines/.venv/bin/python tests/fixtures/espn/derive_sunday.py

No Sunday was captured in progress, so this is synthetic: the games, ids,
kickoffs and team ids are the real week 2 scoreboard
(scoreboard-2026-week2-in-progress.json); DET at BUF is its real final
(event-401872932-final-q4.json); each 1 PM game gets one of the real status
objects captured during DET at BUF (second quarter, halftime, start of the
third) with made-up scores. The late games stay scheduled. Scores are chosen
to cover the ticker's cases: a Comeback, a Shootout, a scoreless live game,
a blowout, a tie.

Each live game also gets a summary, cut to the state's moment (2:30 PM
Eastern: 3:01 left in the 2nd quarter, halftime, or the start of the 3rd):
- scoring plays that add up to its line score, named from src/data/rosters/,
  so the ticker's last score line has something to show;
- drives with the plays the live 4th down feed reads (src/lib/live-fourth/
  summary.ts): each touchdown, and a 4th down snap wherever a drive ends
  without one. The drives are made up around the made-up scores (the home
  team has the ball first, and a team that has not scored by its turn
  punts), but every 4th down is a real one of that team's from nflverse
  play-by-play: its spot, distance and text, jersey numbers and clock taken
  out as ESPN writes it. Each field goal is a real made one, its scoring
  play saying the real distance. A team's 4th downs come from that game's
  first half, then its second half, then the team's other 2026 games. Each
  team that has one also goes for it once: a conversion inside a scoring
  drive, or a stop that ends a drive in place of a punt.
Clocks, play ids and wallclocks are made up, and no timeouts are taken.
Trimmed to the fields the ticker and the feed read, like the other trimmed
fixtures here.
"""

import json
import re
import sys
from datetime import datetime, timedelta
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
ROSTERS = ROOT / 'src' / 'data' / 'rosters'
sys.path.insert(0, str(ROOT / 'pipelines'))

SEASON = {'type': 2, 'year': 2026}
WEEK = {'number': 2}

# ESPN event id: (captured status, away points by quarter, home points by quarter)
LIVE = {
    '401872933': ('halftime-q2', [3, 7], [7, 10]),             # CAR at ATL
    '401872937': ('in_progress-q3', [14, 3, 0], [0, 14, 0]),   # MIN at CHI: CHI came back from 14 down
    '401872939': ('in_progress-q2', [14, 7], [3, 0]),          # PHI at TEN: blowout
    '401872946': ('halftime-q2', [3, 10], [7, 6]),             # PIT at NE: tied
    '401872936': ('in_progress-q3', [7, 17, 0], [3, 7, 0]),    # GB at NYJ
    '401872935': ('in_progress-q2', [0, 0], [0, 0]),           # CLE at TB: no scoring yet
    '401872938': ('halftime-q2', [3, 3], [10, 10]),            # NO at BAL
    '401872934': ('in_progress-q3', [14, 14, 0], [10, 14, 0]), # CIN at HOU: 52 points, a Shootout
}
FINAL = '401872932'  # DET at BUF, Thursday night

# Points in a quarter as scoring plays: 7 a touchdown with the kick, 3 a field goal.
PLAYS = {0: [], 3: [3], 6: [3, 3], 7: [7], 10: [7, 3], 13: [7, 3, 3], 14: [7, 7], 17: [7, 7, 3], 20: [7, 7, 3, 3]}
CLOCKS = ['11:42', '6:15', '1:58', '0:21']

# Game seconds each captured status stands at: the state's moment, 2:30 PM
# Eastern, 90 minutes after the 1 PM kickoffs. Nothing at or after it is kept.
CUT = {'in_progress-q2': 900 + 900 - 181, 'halftime-q2': 1800, 'in_progress-q3': 1800}
MOMENT_MINUTES = 90
# ESPN abbreviations nflverse writes differently.
NFLVERSE = {'LAR': 'LA', 'WSH': 'WAS'}


def load(name: str) -> dict:
    return json.loads((HERE / name).read_text())


def trim(event: dict, status: dict, competitors: list[dict]) -> dict:
    return {
        'id': event['id'],
        'date': event['date'],
        'shortName': event['shortName'],
        'status': status,
        'competitions': [{'competitors': competitors}],
    }


def competitor(base: dict, lines: list[int] | None) -> dict:
    out = {
        'homeAway': base['homeAway'],
        'score': str(sum(lines)) if lines is not None else '0',
        'team': {'id': base['team']['id'], 'abbreviation': base['team']['abbreviation']},
    }
    if lines is not None:
        out['linescores'] = [{'value': v, 'displayValue': str(v), 'period': i + 1} for i, v in enumerate(lines)]
    return out


def names(team: str) -> dict[str, str]:
    """The first active player at each position the scoring plays need."""
    roster = json.loads((ROSTERS / f'{team}.json').read_text())
    found: dict[str, str] = {}
    for player in roster['players']:
        if player.get('status') == 'ACT' and player['position'] in ('QB', 'RB', 'WR', 'TE', 'K'):
            found.setdefault(player['position'], player['name'])
    return found


def scoring_plays(away: dict, home: dict, away_lines: list[int], home_lines: list[int]) -> list[dict]:
    plays, score = [], {'away': 0, 'home': 0}
    turn = 0
    for quarter, (a, h) in enumerate(zip(away_lines, home_lines), start=1):
        # Alternate sides where both scored, so the quarter reads like a game.
        away_plays, home_plays = PLAYS[a], PLAYS[h]
        queue = []
        for i in range(max(len(away_plays), len(home_plays))):
            queue += [('away', away_plays[i])] if i < len(away_plays) else []
            queue += [('home', home_plays[i])] if i < len(home_plays) else []
        for n, (side, points) in enumerate(queue):
            team = away if side == 'away' else home
            who = names(team['team']['abbreviation'])
            kicker = who.get('K', 'Kicker')
            turn += 1
            if points == 7 and turn % 2:
                text = f"{who.get('WR', who.get('TE'))} {12 + 7 * n} Yd pass from {who['QB']} ({kicker} Kick)"
                kind = ('Passing Touchdown', 'TD', 'Touchdown')
            elif points == 7:
                text = f"{who['RB']} {1 + 2 * n} Yd Rush ({kicker} Kick)"
                kind = ('Rushing Touchdown', 'TD', 'Touchdown')
            else:
                text = f'{kicker} {33 + 4 * n} Yd Field Goal'
                kind = ('Field Goal Good', 'FG', 'Field Goal')
            score[side] += points
            plays.append({
                'type': {'text': kind[0], 'abbreviation': kind[1]},
                'scoringType': {'abbreviation': kind[1], 'displayName': kind[2]},
                'text': text,
                'awayScore': score['away'],
                'homeScore': score['home'],
                'period': {'number': quarter},
                'clock': {'displayValue': CLOCKS[min(n, len(CLOCKS) - 1)]},
                'team': {'id': team['team']['id'], 'abbreviation': team['team']['abbreviation']},
            })
    return plays


def seconds(period: int, clock: str) -> int:
    """Game seconds elapsed at a period's clock."""
    minutes, secs = clock.split(':')
    return (period - 1) * 900 + 900 - (int(minutes or 0) * 60 + int(secs))


def period_clock(t: int) -> tuple[int, str]:
    period = t // 900 + 1
    left = period * 900 - t
    return period, f'{left // 60}:{left % 60:02d}'


def espn_text(desc: str) -> str:
    """nflverse's play description as ESPN writes it: no clock, no jersey numbers."""
    text = re.sub(r'^\(\d*:\d\d\)\s*', '', desc.strip())
    return re.sub(r'(?<![A-Za-z0-9])\d{1,2}-(?=[A-Z])', '', text)


def espn_type(row: dict) -> str:
    if row['play_type'] == 'punt':
        return 'Punt'
    if row['play_type'] == 'field_goal':
        return 'Field Goal Good'
    if row['interception'] == 1:
        return 'Pass Interception Return'
    if row['sack'] == 1:
        return 'Sack'
    if row['play_type'] == 'pass':
        return 'Pass Reception' if row['complete_pass'] == 1 else 'Pass Incompletion'
    return 'Rush'


def fourth_downs(pbp) -> dict:
    """Each team's real 4th downs of 2026 by kind, in the order a game takes them."""
    import polars as pl

    rows = pbp.filter(
        (pl.col('season_type') == 'REG') & (pl.col('down') == 4) & (pl.col('penalty') == 0)
        & (pl.col('fumble_lost') == 0) & (pl.col('touchdown') == 0)
    ).select(
        'game_id', 'week', 'posteam', 'defteam', 'qtr', 'game_seconds_remaining', 'play_type', 'field_goal_result',
        'fourth_down_converted', 'interception', 'sack', 'complete_pass', 'yardline_100', 'ydstogo', 'desc',
    ).to_dicts()
    pools: dict = {}
    for row in rows:
        if row['play_type'] == 'punt':
            kind = 'punt'
        elif row['play_type'] == 'field_goal' and row['field_goal_result'] == 'made':
            kind = 'fg'
        elif row['play_type'] in ('run', 'pass') and not re.search(r'formation\)|direct snap', row['desc'], re.I):
            kind = 'converted' if row['fourth_down_converted'] == 1 else 'stopped'
        else:
            continue
        pools.setdefault((row['posteam'], kind), []).append(row)
    return pools


def pick(pools: dict, used: set, team: str, opponent: str, kind: str, game_id: str) -> dict | None:
    """The team's next unused 4th down of a kind: this game's first half, its
    second half, then (punts and field goals only) its other games, the
    opponent named in the text changed to this game's. Going for it is only
    ever this game's."""
    def rank(row):
        here = row['game_id'] == game_id
        return (not here, row['qtr'] > 2 if here else 0, row['week'], -row['game_seconds_remaining'])
    for row in sorted(pools.get((team, kind), []), key=rank):
        if row['desc'] in used or (row['game_id'] != game_id and kind not in ('punt', 'fg')):
            continue
        used.add(row['desc'])
        if row['game_id'] != game_id:
            row = {**row, 'desc': re.sub(rf"\b{row['defteam']}\b", opponent, row['desc'])}
        return row
    return None


def drives(event: dict, sides: dict, scores: list[dict], pools: dict, status: str) -> tuple[list[dict], list[dict]]:
    """Made-up drives around the scoring plays, every 4th down a real one; and the
    scoring plays, each field goal given its real kick's distance."""
    abbr = {s: sides[s]['team']['abbreviation'] for s in ('home', 'away')}
    nfl = {s: NFLVERSE.get(abbr[s], abbr[s]) for s in abbr}
    game_id = f"2026_02_{nfl['away']}_{nfl['home']}"
    other = {'home': 'away', 'away': 'home'}
    used: set = set()
    went = {'home': False, 'away': False}
    cut = CUT[status]

    # (side, real row or None, scoring play or None); a scoring play fixes its time.
    events: list[tuple] = []
    poss = 'home'

    def end_drive(side):
        # A team goes for it once: here a stop ends the drive in place of a punt.
        row = None if went[side] else pick(pools, used, nfl[side], nfl[other[side]], 'stopped', game_id)
        went[side] = went[side] or row is not None
        events.append((side, row or pick(pools, used, nfl[side], nfl[other[side]], 'punt', game_id), None))

    # An exchange of punts before anyone scores.
    for _ in range(2):
        end_drive(poss)
        poss = other[poss]
    for play in scores:
        side = 'home' if play['team']['id'] == sides['home']['team']['id'] else 'away'
        while poss != side:
            end_drive(poss)
            poss = other[poss]
        if not went[side]:
            row = pick(pools, used, nfl[side], nfl[other[side]], 'converted', game_id)
            if row:
                went[side] = True
                events.append((side, row, None))
        if play['scoringType']['abbreviation'] == 'FG':
            row = pick(pools, used, nfl[side], nfl[other[side]], 'fg', game_id)
            distance = re.search(r'(\d+) yard field goal', row['desc']).group(1)
            play['text'] = re.sub(r'\d+ Yd Field Goal', f'{distance} Yd Field Goal', play['text'])
            events.append((side, row, play))
        else:
            events.append((side, None, play))
        poss = other[side]
    # Then punts until the moment, about one a drive's worth of time.
    last = seconds(scores[-1]['period']['number'], scores[-1]['clock']['displayValue']) if scores else 0
    for _ in range(max(0, min(3, (cut - last) // 150 - 1)) if scores else 2):
        end_drive(poss)
        poss = other[poss]

    # Times: a scoring play's own, the rest spread evenly between them.
    fixed = [seconds(p['period']['number'], p['clock']['displayValue']) if p else None for _, _, p in events]
    times: list[int] = []
    i = 0
    while i < len(events):
        if fixed[i] is not None:
            times.append(fixed[i])
            i += 1
            continue
        j = i
        while j < len(events) and fixed[j] is None:
            j += 1
        t0 = times[-1] if times else 0
        t1 = fixed[j] if j < len(events) else cut
        times += [t0 + (t1 - t0) * (k + 1) // (j - i + 1) for k in range(j - i)]
        i = j

    kickoff = datetime.fromisoformat(event['date'].replace('Z', '+00:00'))
    score = {'home': 0, 'away': 0}
    out: list[dict] = []
    for n, ((side, row, scoring), t) in enumerate(zip(events, times)):
        if t >= cut:
            continue
        period, clock = period_clock(t)
        team_id = sides[side]['team']['id']
        if scoring:
            score = {'home': scoring['homeScore'], 'away': scoring['awayScore']}
        if row:
            yl100 = int(row['yardline_100'])
            play = {
                'type': {'text': espn_type(row)},
                'text': espn_text(row['desc']),
                'start': {'down': 4, 'distance': int(row['ydstogo']),
                          'yardLine': 100 - yl100 if side == 'home' else yl100, 'team': {'id': team_id}},
            }
        else:
            play = {
                'type': scoring['type'],
                'text': scoring['text'],
                'start': {'down': 1, 'distance': 10, 'yardLine': 75 if side == 'home' else 25, 'team': {'id': team_id}},
            }
        wall = kickoff + timedelta(seconds=t * MOMENT_MINUTES * 60 // cut)
        out.append({
            'id': f"{event['id']}{(n + 1) * 100}",
            'sequenceNumber': str((n + 1) * 100),
            **play,
            'period': {'number': period},
            'clock': {'displayValue': clock},
            'homeScore': score['home'],
            'awayScore': score['away'],
            'wallclock': wall.strftime('%Y-%m-%dT%H:%M:%SZ'),
        })

    # One drive per possession: the ball always changes hands between them.
    grouped: list[dict] = []
    for play in out:
        if not grouped or grouped[-1]['team'] != play['start']['team']['id']:
            grouped.append({'team': play['start']['team']['id'], 'plays': []})
        grouped[-1]['plays'].append(play)
    return [{'plays': d['plays']} for d in grouped], scores


def main() -> None:
    from pbp_cache import load_pbp

    pools = fourth_downs(load_pbp(2026, 2026))
    base = load('scoreboard-2026-week2-in-progress.json')
    final = load(f'event-{FINAL}-final-q4.json')['events'][0]
    statuses = {
        name: load(f'event-{FINAL}-{name}.json')['events'][0]['status']
        for name in ('in_progress-q2', 'halftime-q2', 'in_progress-q3')
    }

    events = []
    for event in base['events']:
        sides = {c['homeAway']: c for c in event['competitions'][0]['competitors']}
        if event['id'] == FINAL:
            fc = {c['homeAway']: c for c in final['competitions'][0]['competitors']}
            lines = {s: [int(x['value']) for x in fc[s]['linescores']] for s in ('away', 'home')}
            events.append(trim(event, final['status'], [competitor(sides[s], lines[s]) for s in ('home', 'away')]))
        elif event['id'] in LIVE:
            status, away_lines, home_lines = LIVE[event['id']]
            events.append(trim(event, statuses[status], [
                competitor(sides['home'], home_lines), competitor(sides['away'], away_lines)]))
            plays = scoring_plays(sides['away'], sides['home'], away_lines, home_lines)
            game_drives, plays = drives(event, sides, plays, pools, status)
            summary = {
                'derived': 'Synthetic, from derive_sunday.py: not an ESPN response. Every 4th down is a real one from nflverse play-by-play.',
                'header': {'competitions': [{'competitors': [
                    {'homeAway': s, 'team': {'id': sides[s]['team']['id'], 'abbreviation': sides[s]['team']['abbreviation']}}
                    for s in ('home', 'away')
                ]}]},
                'scoringPlays': plays,
                'drives': {'previous': game_drives},
            }
            (HERE / f"summary-{event['id']}-sunday-derived.json").write_text(json.dumps(summary, indent=1) + '\n')
        else:
            scheduled = event.get('status') or event['competitions'][0]['status']
            events.append(trim(event, scheduled, [competitor(sides[s], None) for s in ('home', 'away')]))

    board = {
        'derived': 'Synthetic, from derive_sunday.py: not an ESPN response.',
        'season': SEASON,
        'week': WEEK,
        'events': events,
    }
    (HERE / 'scoreboard-2026-week2-sunday-derived.json').write_text(json.dumps(board, indent=1) + '\n')


if __name__ == '__main__':
    main()
