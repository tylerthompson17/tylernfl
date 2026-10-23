"""Write live-fourth-401873010.json from a raw capture of NE at CHI
(2026-10-22): every change in the scoreboard's situation, polled every 10
seconds from 1:43 left in the 1st quarter to the final, and the game summary
fetched once at the end. The capture itself is not kept.

Each poll becomes a snapshot in the shape src/lib/live-fourth/snapshot.ts
parses a scoreboard event into, with play text cut to 120 characters. From
the summary it keeps every 4th down snap in that span (the expected answers)
and the start of CHI's two punts, where ESPN's yardsToEndzone is wrong.

Run by hand: python tests/fixtures/espn/trim_live_fourth.py <capture dir>
"""

import json
import sys
from datetime import datetime
from pathlib import Path

HOME, AWAY = '3', '17'  # CHI, NE
CUT = 120


def when(s: str) -> datetime:
    return datetime.fromisoformat(s.replace('Z', '+00:00'))


def main(capture: Path) -> None:
    polls = [json.loads(line) for line in (capture / 'situations.jsonl').read_text().splitlines()]
    summary = json.loads((capture / 'summary-401873010.json').read_text())
    plays = [p for drive in summary['drives']['previous'] for p in drive['plays']]

    def last_play(lp):
        if not lp:
            return None
        start = lp.get('start') or {}
        team = (start.get('team') or {}).get('id')
        return {'id': lp['id'], 'type': lp.get('type') or '', 'text': (lp.get('text') or '').strip()[:CUT],
                'start': {'yardLine': start.get('yardLine'), 'team': team}}

    snapshots = []
    for p in polls:
        score = {side: int(points) for side, _, points in p['score']}
        snapshots.append({
            'seen': p['seen'], 'event': p['event'], 'state': p['state'], 'period': p['period'], 'clock': p['clock'],
            'homeId': HOME, 'awayId': AWAY, 'homeScore': score['home'], 'awayScore': score['away'],
            'down': p.get('down'), 'distance': p.get('distance'), 'yardLine': p.get('yardLine'),
            'possession': p.get('possession'), 'homeTimeouts': p.get('homeTimeouts'),
            'awayTimeouts': p.get('awayTimeouts'), 'lastPlay': last_play(p.get('lastPlay')),
        })

    first = when(polls[0]['seen'])
    snaps = [p for p in plays if p['start'].get('down') == 4 and p.get('wallclock') and when(p['wallclock']) > first
             and p['type']['text'] in ('Rush', 'Pass Reception', 'Pass Incompletion', 'Sack', 'Punt',
                                        'Field Goal Good', 'Field Goal Missed')]
    expected = [{'id': p['id'], 'type': p['type']['text'], 'period': p['period']['number'],
                 'clock': p['clock']['displayValue'], 'distance': p['start']['distance'],
                 'yardLine': p['start']['yardLine'], 'team': p['start']['team']['id'],
                 'text': p['text'].strip()[:CUT]} for p in snaps]
    chi_punts = [{'id': p['id'], 'start': p['start'], 'text': p['text'].strip()[:CUT]}
                 for p in plays if p['type']['text'] == 'Punt' and p['start'].get('team', {}).get('id') == HOME]

    out = {
        'captured': 'NE at CHI, 2026-10-22, ESPN scoreboard polled every 10 seconds; game summary once at the final',
        'event': '401873010',
        'teams': {'home': {'id': HOME, 'abbr': 'CHI'}, 'away': {'id': AWAY, 'abbr': 'NE'}},
        'expectedFourthDowns': expected,
        'chiPunts': chi_punts,
        'snapshots': snapshots,
    }
    path = Path(__file__).resolve().parent / 'live-fourth-401873010.json'
    path.write_text(json.dumps(out, indent=1) + '\n')
    print(f'{path.name}: {len(snapshots)} snapshots, {len(expected)} 4th downs, {len(chi_punts)} CHI punts')


if __name__ == '__main__':
    main(Path(sys.argv[1]))
