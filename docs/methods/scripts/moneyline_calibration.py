"""Calibrate the moneyline conversion (betting_lines in pipelines/playoff_odds.py)
against 2019 to 2025 results. Run by hand from the repo root; not part of the
site or CI. The results are in docs/methods/moneyline-win-probability.md.

    python docs/methods/scripts/moneyline_calibration.py
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'pipelines'))
import nflreadpy as nfl, polars as pl
from playoff_odds import betting_lines, implied

rows = nfl.load_schedules(list(range(2019, 2026))).select(
    'game_id', 'season', 'game_type', 'away_score', 'home_score', 'away_moneyline', 'home_moneyline').to_dicts()
played = [r for r in rows if r['home_score'] is not None]
priced = [r for r in played if r['home_moneyline'] is not None and r['away_moneyline'] is not None]
probs = betting_lines(priced)
print(f"games played {len(played)}, with both moneylines {len(priced)}")

def report(games, label):
    ties = [g for g in games if g['home_score'] == g['away_score']]
    decided = [g for g in games if g['home_score'] != g['away_score']]
    p = [probs[g['game_id']] for g in decided]
    y = [1.0 if g['home_score'] > g['away_score'] else 0.0 for g in decided]
    n = len(decided)
    brier = sum((a - b) ** 2 for a, b in zip(p, y)) / n
    base = sum((0.5 - b) ** 2 for b in y) / n
    home_rate = sum(y) / n
    base_home = sum((home_rate - b) ** 2 for b in y) / n
    print(f"\n{label}: {n} decided games ({len(ties)} ties left out)")
    print(f"  Brier {brier:.4f} vs 50/50 {base:.4f} (skill {1 - brier / base:.1%}); vs always-home-rate {home_rate:.3f}: {base_home:.4f}")
    print(f"  mean predicted home {sum(p)/n:.3f}, actual home win rate {home_rate:.3f}")
    print("  bin        games  predicted  actual   95% band")
    for lo in [i / 10 for i in range(10)]:
        idx = [i for i, v in enumerate(p) if lo <= v < lo + 0.1 or (lo == 0.9 and v == 1.0)]
        if not idx:
            continue
        mp = sum(p[i] for i in idx) / len(idx); ma = sum(y[i] for i in idx) / len(idx)
        se = (mp * (1 - mp) / len(idx)) ** 0.5
        flag = '' if abs(ma - mp) <= 1.96 * se else '  outside'
        print(f"  {lo:.1f}-{lo+0.1:.1f}  {len(idx):6d}  {mp:9.3f}  {ma:6.3f}  ±{1.96*se:.3f}{flag}")
    return p, y

report(priced, 'All games 2019-2025')
report([g for g in priced if g['game_type'] == 'REG'], 'Regular season only')

# The margin: raw implied probabilities sum over 1; after the conversion, exactly 1.
over = [implied(g['home_moneyline']) + implied(g['away_moneyline']) for g in priced]
print(f"\nraw implied sum: mean {sum(over)/len(over):.4f}, min {min(over):.4f}, max {max(over):.4f}, under 1: {sum(o < 1 for o in over)}")
away_side = {g['game_id']: implied(g['away_moneyline']) / (implied(g['home_moneyline']) + implied(g['away_moneyline'])) for g in priced}
print(f"home + away after conversion: max |sum - 1| = {max(abs(probs[k] + away_side[k] - 1) for k in probs):.2e}")
by_season = {}
for g in priced: by_season.setdefault(g['season'], []).append(g)
print('per season: ' + ', '.join(f"{s} {len(v)}/{sum(1 for r in played if r['season']==s)}" for s, v in sorted(by_season.items())))
