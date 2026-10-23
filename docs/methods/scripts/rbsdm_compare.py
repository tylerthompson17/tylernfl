"""Compare decisions.json with rbsdm.com's 4th down numbers for the plays in
tests/fixtures/decisions/rbsdm-*.json (copied by hand from rbsdm.com).

rbsdm shows nfl4th's go_boost: going for it minus the best kick. Ours is the
same from decisions.json: wpGo minus the larger of wpPunt and wpFieldGoal.
A play rbsdm lists as a delay of game is matched to our entry graded at
that spot (decisions.py grades a punt or field goal after the offense's
delay of game at the spot before it).

Run from the repo root: python docs/methods/scripts/rbsdm_compare.py
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
fixture = sorted((ROOT / 'tests' / 'fixtures' / 'decisions').glob('rbsdm-*.json'))[-1]
plays = json.loads(fixture.read_text())['plays']
decisions = json.loads((ROOT / 'src' / 'data' / 'decisions.json').read_text())['fourthDowns']

print(f'{fixture.name}: {len(plays)} plays\n')
print(f"{'team':4} {'wk':>2} {'spot':>4} {'togo':>4}  {'rbsdm':>5} {'ours':>5} {'diff':>5}  best kick   team did")
diffs = []
for p in plays:
    match = [
        d for d in decisions
        if d['situation']['posteam'] == p['team'] and d['week'] == p['week']
        and d['situation']['yardline100'] == p['yardline100'] and d['situation']['distance'] == p['distance']
    ]
    if len(match) != 1:
        print(f"{p['team']:4} {p['week']:>2} {p['yardline100']:>4} {p['distance']:>4}  no single match ({len(match)})")
        continue
    d = match[0]
    kicks = {'punt': d['wpPunt'], 'field goal': d['wpFieldGoal']}
    best = max((k for k, v in kicks.items() if v is not None), key=lambda k: kicks[k])
    ours = (d['wpGo'] - kicks[best]) * 100
    diffs.append(ours - p['boost'])
    print(f"{p['team']:4} {p['week']:>2} {p['yardline100']:>4} {p['distance']:>4}  {p['boost']:>5.1f} {ours:>5.1f} "
          f"{ours - p['boost']:>+5.1f}  {best:10}  {d['teamCall']}"
          + (f" (after a delay of game, {d['delayOfGame']['yardsBack']} yards back)" if d['delayOfGame'] else ''))
print(f'\nlargest difference {max(map(abs, diffs)):.1f} points; '
      f'{sum(abs(x) <= 0.1 for x in diffs)} of {len(diffs)} within 0.1 (rbsdm rounds to 0.1)')
sys.exit(0)
