"""Derives a week 2 Sunday scoreboard, mid-afternoon, from the real Thursday
capture, for the audit's Sunday date state (tests/fixtures/states/). Run by
hand from the repo root with any Python 3:

    python3 tests/fixtures/espn/derive_sunday.py

No Sunday was captured in progress, so this is synthetic: the games, ids,
kickoffs and team ids are the real week 2 scoreboard
(scoreboard-2026-week2-in-progress.json); DET at BUF is its real final
(event-401872932-final-q4.json); each 1 PM game gets one of the real status
objects captured during DET at BUF (second quarter, halftime, start of the
third) with made-up scores. The late games stay scheduled. Scores are chosen
to cover the ticker's cases: a Comeback, a Shootout, a scoreless live game,
a blowout, a tie.

Each live game with points also gets a summary whose scoring plays add up
to its line score, named from src/data/rosters/, so the ticker's last score
line has something to show. Trimmed to the fields the ticker reads, like the
other trimmed fixtures here.
"""

import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROSTERS = HERE.parents[2] / 'src' / 'data' / 'rosters'

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


def main() -> None:
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
            if plays:
                summary = {
                    'derived': 'Synthetic, from derive_sunday.py: not an ESPN response.',
                    'header': {'competitions': [{'competitors': [
                        {'homeAway': s, 'team': {'id': sides[s]['team']['id'], 'abbreviation': sides[s]['team']['abbreviation']}}
                        for s in ('home', 'away')
                    ]}]},
                    'scoringPlays': plays,
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
