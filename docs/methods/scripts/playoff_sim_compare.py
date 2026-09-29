"""Compare the site's playoff simulation with nflseedR's, fed the same game
probabilities. Run by hand from the repo root; not part of the site or CI.

    python docs/methods/scripts/playoff_sim_compare.py prepare
    Rscript docs/methods/scripts/playoff_sim_compare.R
    python docs/methods/scripts/playoff_sim_compare.py compare

For each checkpoint (a season, played through a given week), the games up
to that week keep their real results, and every later regular season game
gets its home win chance from its closing moneyline through the site's own
betting_lines. `prepare` writes those games for R and runs the site's
simulator; the R script runs nflseedR 2.0.2 on the same games, with a
results function that draws each game from the same chance; `compare`
reports the differences. Files go to docs/methods/scripts/out/ (ignored).
"""

import csv
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'pipelines'))

from common import normalize_team  # noqa: E402

OUT = Path(__file__).resolve().parent / 'out'
CHECKPOINTS = [(2023, 12), (2024, 9)]
SIMULATIONS = 10_000


def prepare() -> None:
    import nflreadpy as nfl

    from playoff_odds import betting_lines, build_playoff_odds

    OUT.mkdir(exist_ok=True)
    for season, week in CHECKPOINTS:
        rows = [r for r in nfl.load_schedules(season).to_dicts() if r['game_type'] == 'REG']
        for r in rows:
            if r['week'] > week:
                r['away_score'] = r['home_score'] = None
        unplayed = [r for r in rows if r['home_score'] is None]
        chances = betting_lines(unplayed)

        with open(OUT / f'games_{season}_{week}.csv', 'w', newline='') as f:
            w = csv.writer(f)
            # nflseedR requires rest days and location; its default results
            # function reads them, the fixed-chance one used here does not.
            w.writerow(['game_id', 'season', 'game_type', 'week', 'away_team', 'home_team', 'away_rest', 'home_rest',
                        'location', 'result', 'p_home'])
            for r in rows:
                result = '' if r['home_score'] is None else r['home_score'] - r['away_score']
                w.writerow([r['game_id'], season, 'REG', r['week'], r['away_team'], r['home_team'], r['away_rest'],
                            r['home_rest'], r['location'], result,
                            chances.get(r['game_id'], '')])

        odds = build_playoff_odds(rows, season, 'x', n=SIMULATIONS, game_probabilities=lambda games: chances)
        (OUT / f'site_{season}_{week}.json').write_text(json.dumps(odds['teams']))
        print(f'{season} through week {week}: {len(unplayed)} games to simulate')


def compare() -> None:
    for season, week in CHECKPOINTS:
        site = {t['team']: t for t in json.loads((OUT / f'site_{season}_{week}.json').read_text())}
        with open(OUT / f'nflseedr_{season}_{week}.csv') as f:
            seedr = {normalize_team(r['team']): r for r in csv.DictReader(f)}
        print(f'\n{season}, played through week {week}, {SIMULATIONS:,} simulations each')
        for key, column in [('playoffs', 'playoff'), ('division', 'div1'), ('topSeed', 'seed1')]:
            diffs = sorted(((abs(site[t][key] - float(seedr[t][column])), t) for t in site), reverse=True)
            mean = sum(d for d, _ in diffs) / len(diffs)
            print(f'  {key:9} mean |diff| {mean:.4f}, largest {diffs[0][0]:.4f} ({diffs[0][1]}: '
                  f'site {site[diffs[0][1]][key]:.3f}, nflseedR {float(seedr[diffs[0][1]][column]):.3f})')
        wins = max(abs(site[t]['meanWins'] - float(seedr[t]['wins'])) for t in site)
        print(f'  meanWins  largest |diff| {wins:.2f}')


if __name__ == '__main__':
    {'prepare': prepare, 'compare': compare}[sys.argv[1]]()
