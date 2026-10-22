"""Compare the site's projected draft order with nflseedR's, fed the same
game probabilities. Run by hand from the repo root; not part of the site or CI.

    python docs/methods/scripts/playoff_sim_compare.py prepare
    Rscript docs/methods/scripts/draft_sim_compare.R
    python docs/methods/scripts/draft_sim_compare.py

The checkpoints and games are playoff_sim_compare.py's (its `prepare` writes
them): closing moneylines for every remaining regular season game, every
playoff game even. The R script runs nflseedR 2.0.2 with its draft order
(sim_include = "DRAFT"); this script runs the site's DraftProjection on the
same games, 10,000 seasons each, and reports the differences per team in
mean pick and the chances of pick 1, top 3, top 5 and top 10. Pick
ownership is left out: both rank each team's own pick.
"""

import csv
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'pipelines'))

from common import normalize_team  # noqa: E402
from playoff_odds import DraftProjection, build_playoff_odds  # noqa: E402
from standings import load_alignment  # noqa: E402

OUT = Path(__file__).resolve().parent / 'out'
CHECKPOINTS = [(2023, 12), (2024, 9)]
SIMULATIONS = 10_000
MEASURES = [('first', 1), ('top3', 3), ('top5', 5), ('top10', 10)]


def site(season: int, week: int) -> dict[str, dict]:
    rows, chances = [], {}
    with open(OUT / f'games_{season}_{week}.csv') as f:
        for r in csv.DictReader(f):
            played = r['result'] != ''
            rows.append({
                'game_id': r['game_id'], 'season': season, 'game_type': 'REG', 'week': int(r['week']),
                'away_team': r['away_team'], 'home_team': r['home_team'],
                'away_score': 0 if played else None, 'home_score': int(r['result']) if played else None,
                'home_moneyline': None, 'away_moneyline': None,
            })
            if r['p_home']:
                chances[r['game_id']] = float(r['p_home'])
    alignment = load_alignment()
    projection = DraftProjection({'picks': [], 'choices': []}, list(alignment))
    odds = build_playoff_odds(rows, season, 'x', n=SIMULATIONS, game_probabilities=lambda games: chances,
                              draft=projection)
    return {t['team']: t for t in projection.result(odds)['teams']}


def nflseedr(season: int, week: int) -> dict[str, dict]:
    picks = defaultdict(list)
    with open(OUT / f'nflseedr_draft_{season}_{week}.csv') as f:
        for r in csv.DictReader(f):
            picks[normalize_team(r['team'])].append(int(r['draft_rank']))
    summary = {}
    for team, ranks in picks.items():
        n = len(ranks)
        summary[team] = {'meanPick': sum(ranks) / n,
                         **{key: sum(1 for p in ranks if p <= top) / n for key, top in MEASURES}}
    return summary


def main() -> None:
    for season, week in CHECKPOINTS:
        ours, theirs = site(season, week), nflseedr(season, week)
        print(f'\n{season}, played through week {week}, {SIMULATIONS:,} simulations each')
        for key in ['meanPick'] + [k for k, _ in MEASURES]:
            diffs = sorted(((abs(ours[t][key] - theirs[t][key]), t) for t in ours), reverse=True)
            mean = sum(d for d, _ in diffs) / len(diffs)
            worst = diffs[0][1]
            print(f'  {key:8} mean |diff| {mean:.4f}, largest {diffs[0][0]:.4f} '
                  f'({worst}: site {ours[worst][key]:.3f}, nflseedR {theirs[worst][key]:.3f})')


if __name__ == '__main__':
    main()
