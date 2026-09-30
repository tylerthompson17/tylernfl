"""How the notable performances ranking depends on the seasons in its pool.
Run by hand from the repo root; not part of the site or CI. The results are
in docs/methods/notable-performances.md.

    python docs/methods/scripts/notable_sensitivity.py

For every week of 2025, the week's top five (the site's rule, reimplemented
here: percentile with ties as half, one row per player, a stat of zero left
out, ties to the category listed first) is found twice: against team games
from 1999 to 2024, and from 2019 to 2024 only. It reports how often the two
agree, and which categories the full pool's top fives are made of.
"""
import sys
from bisect import bisect_left, bisect_right
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'pipelines'))

import nflreadpy as nfl  # noqa: E402
import polars as pl  # noqa: E402

from performance_percentiles import CATEGORIES, team_leader_counts  # noqa: E402

stats = nfl.load_player_stats(list(range(1999, 2026)), summary_level='week').filter(pl.col('season_type') == 'REG')
columns = ['season', 'week', 'team', 'player_id', 'passing_yards', 'rushing_yards', 'receiving_yards',
           'def_sacks', 'fg_made', 'fg_att']
rows = stats.select(columns).to_dicts()


def pools(first: int, last: int) -> dict[str, list[float]]:
    counts = team_leader_counts([r for r in rows if first <= r['season'] <= last])
    return {board: sorted(v for v, n in tally.items() for _ in range(n)) for board, tally in counts.items()}


def pct(pool: list[float], value: float) -> float:
    lo, hi = bisect_left(pool, value), bisect_right(pool, value)
    return (lo + (hi - lo) / 2) / len(pool)


def top5(week_rows: list[dict], pool: dict[str, list[float]]) -> list[tuple]:
    scored = []
    for order, (board, stat, _) in enumerate(CATEGORIES):
        for r in week_rows:
            value = r[stat] or 0
            if value > 0:
                scored.append((-pct(pool[board], value), order, r['player_id'], board))
    out, seen = [], set()
    for _, _, player, board in sorted(scored):
        if player not in seen:
            seen.add(player)
            out.append((player, board))
        if len(out) == 5:
            break
    return out


full, recent = pools(1999, 2024), pools(2019, 2024)
weeks = sorted({r['week'] for r in rows if r['season'] == 2025})
same_set = same_first = same_order = 0
overlap = 0
mix_full, mix_recent = Counter(), Counter()
for week in weeks:
    week_rows = [r for r in rows if r['season'] == 2025 and r['week'] == week]
    a, b = top5(week_rows, full), top5(week_rows, recent)
    overlap += len(set(a) & set(b))
    same_set += set(a) == set(b)
    same_order += a == b
    same_first += a[0] == b[0]
    mix_full.update(board for _, board in a)
    mix_recent.update(board for _, board in b)

n = len(weeks)
print(f'2025, {n} weeks: same top five {same_set}/{n}, same order {same_order}/{n}, '
      f'same first {same_first}/{n}, average overlap {overlap / n:.2f} of 5')
print('categories in the top fives, 1999-2024 pool:', dict(mix_full))
print('categories in the top fives, 2019-2024 pool:', dict(mix_recent))
