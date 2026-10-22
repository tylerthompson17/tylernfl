"""Tune and validate the team ratings (pipelines/team_ratings.py) on 2015 to
2025. Run by hand from the repo root; not part of the site or CI. The
results are in docs/methods/team-ratings.md.

    python docs/methods/scripts/team_ratings_backtest.py

For each season and cutoff week w, the ratings are fitted the way the daily
run fits them: every game through week w with its closing line, plus the
lines of the next two weeks (LOOKAHEAD), which the daily run has by
midweek, counted from the date of the last game of week w. No later line is
seen. They then price the rest of the regular season, and the log loss is
taken on the real results (ties left out). The current setup prices the
same two weeks from their lines and every later game at 50/50.
"""
import itertools
import math
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'pipelines'))
import nflreadpy as nfl  # noqa: E402
import numpy as np  # noqa: E402

import team_ratings as tr  # noqa: E402
from playoff_odds import betting_lines  # noqa: E402

SEASONS = list(range(2015, 2026))
CUTOFFS = [1, 2, 4, 6, 8, 10, 12, 14]
LOOKAHEAD = 2
GRID = {
    'carryover': [0.4, 0.55, 0.7, 0.85, 1.0],
    'half_life_weeks': [1.0, 1.5, 2.0, 3.0, 4.5, 6.0, 10.0, math.inf],
    'penalty': [0.1, 0.3, 1.0, 3.0],
}
SIGMAS = [0.0, 0.2, 0.4, 0.5, 0.6, 0.65, 0.7, 0.8, 1.0, 1.2]
DRAWS = 4000
NODES, WEIGHTS = np.polynomial.hermite_e.hermegauss(40)
WEIGHTS = WEIGHTS / WEIGHTS.sum()

columns = ['game_id', 'season', 'game_type', 'week', 'gameday', 'away_team', 'home_team', 'away_score',
           'home_score', 'location', 'away_moneyline', 'home_moneyline']
rows = nfl.load_schedules(list(range(SEASONS[0] - 1, SEASONS[-1] + 1))).select(columns).to_dicts()
by_season = {s: [g for g in rows if g['season'] == s] for s in range(SEASONS[0] - 1, SEASONS[-1] + 1)}
teams_of = {s: sorted({tr.franchise(g[side]) for g in games for side in ('home_team', 'away_team')})
            for s, games in by_season.items()}
line_p = betting_lines([g for g in rows if tr.has_line(g)])


def outcome(g):
    return None if g['home_score'] == g['away_score'] else float(g['home_score'] > g['away_score'])


def expected(mu, sigma):
    """Mean of logistic(k mu + d) with d ~ N(0, 2 sigma^2), two ratings drawn
    and the logit stretched first (team_ratings.stretch), as the simulator does."""
    if sigma == 0:
        return 1 / (1 + np.exp(-mu))
    k = tr.stretch(sigma)
    return (WEIGHTS / (1 + np.exp(-(k * mu[:, None] + math.sqrt(2) * sigma * NODES[None, :])))).sum(axis=1)


def log_loss(p, y):
    p = np.clip(p, 1e-9, 1 - 1e-9)
    return -(y * np.log(p) + (1 - y) * np.log(1 - p))


def cutoff_date(season, w):
    return max(date.fromisoformat(g['gameday']) for g in by_season[season] if g['game_type'] == 'REG' and g['week'] <= w)


def fit_at(season, w, prior, c, hl, lam, lookahead=LOOKAHEAD):
    known = [g for g in by_season[season] if g['game_type'] == 'REG' and g['week'] <= w + lookahead]
    return tr.fit(known, teams_of[season], cutoff_date(season, w), prior, c, hl, lam)


# Last season's final ratings depend on the half-life and the penalty only.
finals = {}
for hl, lam in itertools.product(GRID['half_life_weeks'], GRID['penalty']):
    for s in range(SEASONS[0] - 1, SEASONS[-1]):
        games = [g for g in by_season[s] if tr.has_line(g)]
        last = max(date.fromisoformat(g['gameday']) for g in games)
        finals[(s, hl, lam)] = tr.fit(games, teams_of[s], last, None, 1.0, hl, lam)[0]

# Per season and cutoff: the rest of the regular season, split into the
# games the lookahead prices from lines (near) and the rest (far).
cases = {}
for s, w in itertools.product(SEASONS, CUTOFFS):
    rest = [g for g in by_season[s] if g['game_type'] == 'REG' and g['week'] > w and outcome(g) is not None]
    near = [g for g in rest if g['week'] <= w + LOOKAHEAD]
    far = [g for g in rest if g['week'] > w + LOOKAHEAD]
    cases[(s, w)] = (near, far, np.array([outcome(g) for g in near]), np.array([outcome(g) for g in far]))


def far_fit(s, w, c, hl, lam):
    """The ratings at cutoff w, and each far game's (home, away, home field) logit."""
    ratings, h = fit_at(s, w, finals[(s - 1, hl, lam)], c, hl, lam)
    far = cases[(s, w)][1]
    mu = np.array([ratings[tr.franchise(g['home_team'])] - ratings[tr.franchise(g['away_team'])]
                   + (0 if tr.is_neutral(g) else h) for g in far])
    return ratings, h, mu


def mean_over(per, seasons):
    return sum(per[s][0] for s in seasons) / sum(per[s][1] for s in seasons)


# Step 1: carryover, half-life and penalty, on the far games' log loss with
# the ratings as estimated (sigma 0; sigma barely moves a single game, below).
print('Fitting the grid...', file=sys.stderr)
fit_grid = list(itertools.product(*GRID.values()))
fits = {(params, s, w): far_fit(s, w, *params) for params in fit_grid for s, w in cases}
loss = {}  # params -> {season: (sum, count)}
for params in fit_grid:
    loss[params] = {}
    for s in SEASONS:
        total = count = 0
        for w in CUTOFFS:
            y = cases[(s, w)][3]
            total += log_loss(expected(fits[(params, s, w)][2], 0), y).sum()
            count += len(y)
        loss[params][s] = (total, count)

best = min(loss, key=lambda k: mean_over(loss[k], SEASONS))
c, hl, lam = best
print(f'Fit grid: {" x ".join(str(len(v)) for v in GRID.values())} = {len(fit_grid)} points; '
      f'then sigma over {len(SIGMAS)} values at the chosen fit: {len(fit_grid) + len(SIGMAS)} settings in all.')
for name, values in GRID.items():
    print(f'  {name}: {values}')
print(f'  sigma: {SIGMAS}')
print(f'Best on 2015-2025: carryover {c}, half-life {hl} weeks, penalty {lam} '
      f'-> far-game log loss {mean_over(loss[best], SEASONS):.4f}')
for i, name in enumerate(GRID):
    line = []
    for v in GRID[name]:
        k = tuple(v if j == i else best[j] for j in range(3))
        line.append(f'{v}: {mean_over(loss[k], SEASONS):.4f}')
    print(f'  {name} (others at best): ' + ', '.join(line))

print('\nLeave one season out (choose on the other ten, score the one left; far games):')
held_total = held_count = 0
for s in SEASONS:
    others = [x for x in SEASONS if x != s]
    choice = min(loss, key=lambda k: mean_over(loss[k], others))
    held_total += loss[choice][s][0]
    held_count += loss[choice][s][1]
    print(f'  {s}: chose {choice}, held-out {loss[choice][s][0] / loss[choice][s][1]:.4f}, '
          f'overall best {loss[best][s][0] / loss[best][s][1]:.4f}')
print(f'  pooled held-out {held_total / held_count:.4f} vs in-sample best {mean_over(loss[best], SEASONS):.4f}')

# Step 2: sigma, on the rest of the season's win totals. One game's chance
# hardly changes with sigma, but a team's games all move together with its
# drawn rating, which widens its win total. Sigma is set so that the squared
# miss of each team's far-game wins, over the variance the draws predict,
# averages 1.
draws_rng = np.random.default_rng(2026)
normal = draws_rng.standard_normal((DRAWS, 40))


def win_totals(s, w, sigma):
    """Per team: (actual far-game wins, predicted mean, predicted variance)."""
    ratings, h, _ = fits[(best, s, w)]
    teams = teams_of[s]
    index = {t: i for i, t in enumerate(teams)}
    far = cases[(s, w)][1]
    if not far:
        return []
    k = tr.stretch(sigma)
    r = k * np.array([ratings[t] for t in teams])[None, :] + sigma * normal[:, :len(teams)]
    hi = np.array([index[tr.franchise(g['home_team'])] for g in far])
    ai = np.array([index[tr.franchise(g['away_team'])] for g in far])
    nn = np.array([0.0 if tr.is_neutral(g) else 1.0 for g in far])
    p = 1 / (1 + np.exp(-(r[:, hi] - r[:, ai] + k * h * nn)))  # draws x games
    out = []
    for t, i in index.items():
        home, away = hi == i, ai == i
        if not (home.any() or away.any()):
            continue
        q = np.concatenate([p[:, home], 1 - p[:, away]], axis=1)  # this team's win chances
        totals = q.sum(axis=1)
        mean = totals.mean()
        var = (q * (1 - q)).sum(axis=1).mean() + totals.var()
        actual = sum(1.0 if (g['home_score'] > g['away_score']) == (tr.franchise(g['home_team']) == t) else 0.0
                     if g['home_score'] != g['away_score'] else 0.5
                     for g in (x for x, a, b in zip(far, home, away) if a or b))
        out.append((actual, mean, var))
    return out


# Ties count as half a win here, so the far games include them.
for key in list(cases):
    s, w = key
    near, _, y_near, y_far = cases[key]
    far_all = [g for g in by_season[s] if g['game_type'] == 'REG' and g['week'] > w + LOOKAHEAD]
    cases[key] = (near, far_all, y_near, y_far)
fits = {(best, s, w): far_fit(s, w, *best) for s, w in cases}

print('\nSigma on win totals: mean of (actual - predicted)^2 / predicted variance, target 1')
ratio = {}
for sigma in SIGMAS:
    rows_ = [x for s, w in cases for x in win_totals(s, w, sigma)]
    ratio[sigma] = np.mean([(a - m) ** 2 / v for a, m, v in rows_])
print('  ' + ', '.join(f'{k}: {v:.3f}' for k, v in ratio.items()))
sigma = min(SIGMAS, key=lambda k: abs(ratio[k] - 1))
print(f'  chosen sigma {sigma} (team-season cases: {len(rows_)})')
for group in ([1, 2], [4, 6], [8, 10], [12, 14]):
    by_sigma = {}
    for sg in SIGMAS:
        rows_ = [x for s in SEASONS for w in group for x in win_totals(s, w, sg)]
        by_sigma[sg] = np.mean([(a - m) ** 2 / v for a, m, v in rows_])
    print(f'  after weeks {group}: closest to 1 at sigma {min(SIGMAS, key=lambda k: abs(by_sigma[k] - 1))}; '
          + ', '.join(f'{k}: {v:.3f}' for k, v in by_sigma.items()))
    # How often the actual total lands in the middle 80% the draws predict (normal approximation).
    rows_ = [x for s in SEASONS for w in group for x in win_totals(s, w, sigma)]
    rows0 = [x for s in SEASONS for w in group for x in win_totals(s, w, 0.0)]
    inside = lambda rs: np.mean([abs(a - m) <= 1.2816 * math.sqrt(v) for a, m, v in rs])
    print(f'    actual inside the predicted 80% range: sigma 0 {inside(rows0):.0%}, sigma {sigma} {inside(rows_):.0%}')

# The same measure on the closing lines of the same games, a check on the
# measure: lines set a week ahead know what the ratings could not.
oracle = []
for s, w in cases:
    for t in teams_of[s]:
        games = [g for g in cases[(s, w)][1] if t in (tr.franchise(g['home_team']), tr.franchise(g['away_team']))]
        if not games:
            continue
        q = [line_p.get(g['game_id'], 0.5) if tr.franchise(g['home_team']) == t else 1 - line_p.get(g['game_id'], 0.5) for g in games]
        actual = sum(0.5 if g['home_score'] == g['away_score'] else
                     float((g['home_score'] > g['away_score']) == (tr.franchise(g['home_team']) == t)) for g in games)
        oracle.append((actual - sum(q)) ** 2 / sum(x * (1 - x) for x in q))
print(f'  closing lines on the same games, no sigma: {np.mean(oracle):.3f}')

# Back to decided games only, for the log loss tables.
for key in list(cases):
    s, w = key
    near, far_all, y_near, y_far = cases[key]
    cases[key] = (near, [g for g in far_all if outcome(g) is not None], y_near, y_far)
fits = {(best, s, w): far_fit(s, w, *best) for s, w in cases}

point = np.concatenate([expected(fits[(best, s, w)][2], 0) for s, w in cases])
averaged = np.concatenate([expected(fits[(best, s, w)][2], sigma) for s, w in cases])
print(f'\nAveraged over the draws at sigma {sigma}, against the point estimate: '
      f'mean gap {np.abs(averaged - point).mean():.4f}, largest {np.abs(averaged - point).max():.4f}')
print('\nOne game\'s log loss by sigma, with the stretch (far games, pooled):')
print('  ' + ', '.join(f'{sg}: {np.mean(np.concatenate([log_loss(expected(fits[(best, s, w)][2], sg), cases[(s, w)][3]) for s, w in cases])):.4f}'
                       for sg in SIGMAS))

print('\nRest of the regular season after week w (ties left out), log loss:')
print('  w   games  50/50   current  ratings  all closing lines   | far games only: n   current  ratings')
calib_p, calib_y, calib_line, calib_ids, calib_seasons = [], [], [], [], []
totals = {'n': 0, 'even': 0.0, 'current': 0.0, 'ratings': 0.0, 'lines': 0.0}
for w in CUTOFFS:
    sums = {'even': 0.0, 'current': 0.0, 'ratings': 0.0, 'lines': 0.0, 'far_current': 0.0, 'far_ratings': 0.0}
    n = n_far = 0
    for s in SEASONS:
        near, far, y_near, y_far = cases[(s, w)]
        p_near = np.array([line_p.get(g['game_id'], 0.5) for g in near])
        p_far = expected(fits[(best, s, w)][2], sigma)
        p_far_lines = np.array([line_p.get(g['game_id'], 0.5) for g in far])
        near_loss = log_loss(p_near, y_near).sum()
        sums['even'] += math.log(2) * (len(near) + len(far))
        sums['current'] += near_loss + math.log(2) * len(far)
        sums['ratings'] += near_loss + log_loss(p_far, y_far).sum()
        sums['lines'] += near_loss + log_loss(p_far_lines, y_far).sum()
        sums['far_current'] += math.log(2) * len(far)
        sums['far_ratings'] += log_loss(p_far, y_far).sum()
        n += len(near) + len(far)
        n_far += len(far)
        calib_p.extend(p_far)
        calib_y.extend(y_far)
        calib_line.extend(p_far_lines)
        calib_ids.extend(g['game_id'] for g in far)
        calib_seasons.extend([s] * len(far))
    for k in ('even', 'current', 'ratings', 'lines'):
        totals[k] += sums[k]
    totals['n'] += n
    print(f'  {w:2d}  {n:5d}  {sums["even"] / n:.4f}  {sums["current"] / n:.4f}   {sums["ratings"] / n:.4f}   '
          f'{sums["lines"] / n:.4f}            | {n_far:5d}  {sums["far_current"] / n_far:.4f}   {sums["far_ratings"] / n_far:.4f}')
n = totals['n']
appearances = {}
for i in calib_ids:
    appearances[i] = appearances.get(i, 0) + 1
print(f'  all {n:5d}  {totals["even"] / n:.4f}  {totals["current"] / n:.4f}   {totals["ratings"] / n:.4f}   {totals["lines"] / n:.4f}')

print('\nCalibration, far games, every season and cutoff pooled. A game appears once per cutoff before it,')
print('so each appearance is weighted 1 / appearances: every game counts once, and the band uses that count.')
print('  predicted    games  mean predicted  actual   95% band          | closing lines on the same games')
calib_p, calib_y, calib_line = np.array(calib_p), np.array(calib_y), np.array(calib_line)
calib_w = 1 / np.array([appearances[i] for i in calib_ids])
for lo in [i / 10 for i in range(10)]:
    mask = (calib_p >= lo) & ((calib_p < lo + 0.1) | ((lo == 0.9) & (calib_p <= 1)))
    if not mask.any():
        continue
    w_ = calib_w[mask]
    k = w_.sum()
    mp, ma, ml = (np.average(x[mask], weights=w_) for x in (calib_p, calib_y, calib_line))
    band = 1.96 * math.sqrt(mp * (1 - mp) / k)
    print(f'  {lo:.1f} to {lo + 0.1:.1f}  {k:6.0f}  {mp:14.3f}  {ma:6.3f}   ±{band:.3f}{"" if abs(ma - mp) <= band else "  outside"}'
          f'{"":10s}| {ml:.3f}')
print(f'  all        {calib_w.sum():6.0f}  {np.average(calib_p, weights=calib_w):14.3f}  {np.average(calib_y, weights=calib_w):6.3f}'
      f'   (closing lines on the same games {np.average(calib_line, weights=calib_w):.3f})')


def calibration_fit(p, y, w):
    """Weighted logistic regression of the result on logit(p): (intercept, slope).
    Calibrated is (0, 1)."""
    x = np.column_stack([np.ones_like(p), np.log(p / (1 - p))])
    beta = np.array([0.0, 1.0])
    for _ in range(25):
        q = 1 / (1 + np.exp(-x @ beta))
        hess = x.T @ (x * (w * q * (1 - q))[:, None])
        beta = beta + np.linalg.solve(hess, x.T @ (w * (y - q)))
    return beta


season_of_row = np.array(calib_seasons)
point = calibration_fit(calib_p, calib_y, calib_w)
boot_rng = np.random.default_rng(15)
boots = []
for _ in range(1000):
    pick = boot_rng.choice(SEASONS, size=len(SEASONS))
    idx = np.concatenate([np.flatnonzero(season_of_row == s) for s in pick])
    boots.append(calibration_fit(calib_p[idx], calib_y[idx], calib_w[idx]))
lo_, hi_ = np.percentile(np.array(boots), [2.5, 97.5], axis=0)
print(f'  calibration intercept {point[0]:+.3f} (95% {lo_[0]:+.3f} to {hi_[0]:+.3f}, seasons resampled; 0 is calibrated)')
print(f'  calibration slope     {point[1]:.3f} (95% {lo_[1]:.3f} to {hi_[1]:.3f}; 1 is calibrated)')
line_fit = calibration_fit(calib_line, calib_y, calib_w)
print(f'  closing lines on the same games: intercept {line_fit[0]:+.3f}, slope {line_fit[1]:.3f}')

print('\nNext week\'s closing lines, from ratings fitted through week w without them (no lookahead):')
print('  w   games  mean |diff| in win chance  RMSE logit  within 5 pts  | 50/50 mean |diff|')
all_diffs = []
for w in CUTOFFS:
    diffs, logit_diffs, even = [], [], []
    for s in SEASONS:
        ratings, h = fit_at(s, w, finals[(s - 1, hl, lam)], c, hl, lam, lookahead=0)
        pricer = tr.Pricer(ratings, h, 0)
        for g in by_season[s]:
            if g['game_type'] != 'REG' or g['week'] != w + 1 or not tr.has_line(g):
                continue
            p, q = pricer.chance(g), line_p[g['game_id']]
            diffs.append(abs(p - q))
            logit_diffs.append(tr.logit(p) - tr.logit(q))
            even.append(abs(0.5 - q))
    all_diffs.extend(diffs)
    diffs, logit_diffs = np.array(diffs), np.array(logit_diffs)
    print(f'  {w:2d}  {len(diffs):5d}  {diffs.mean():.3f}                      {math.sqrt((logit_diffs ** 2).mean()):.3f}       '
          f'{(diffs <= 0.05).mean():.0%}         | {np.mean(even):.3f}')
all_diffs = np.array(all_diffs)
print(f'  all {len(all_diffs):5d}  {all_diffs.mean():.3f}, median {np.median(all_diffs):.3f}, 90th percentile {np.quantile(all_diffs, 0.9):.3f}')

hs = [fit_at(s, 8, finals[(s - 1, hl, lam)], c, hl, lam)[1] for s in SEASONS]
print('\nHome field (logit) after week 8: ' + ', '.join(f'{s} {h:.3f}' for s, h in zip(SEASONS, hs)))
