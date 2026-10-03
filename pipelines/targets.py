"""Build src/data/targets/<gsis id>.json from nflverse play-by-play: where
each player's targets went (receivers) and where his throws went (passers),
on a grid of three horizontal zones by four depth bands.

Regular season only, every final game: the same season and games as
team_stats.py and player_epa.py, written by the daily job next to them.
EPA is nflfastR's, as published in nflverse play-by-play. These are
descriptive counts, not a model of this site's.

Which plays count, in the order the filters run (each run prints how many
plays each one removes):
- pass plays (`pass_attempt`), then leaving out
- plays nullified by a penalty (`play_type` no_play). nflverse already
  clears the receiver on these, so this removes almost nothing; it also
  means defensive pass interference, a no_play with no receiver and no air
  yards, is never a target,
- two-point attempts, spikes and sacks,
- passes with no intended receiver (throwaways), no `pass_location` or no
  `air_yards`, and the rare play with no EPA.

Grid:
- Zones are nflverse's `pass_location` (left, middle, right), as charted,
  not exact field position.
- Depth is `air_yards`: behind the line (under 0), short (0 to 9),
  intermediate (10 to 19), deep (20 and more). Air yards are whole numbers.

Per cell: targets, receptions (`complete_pass`), catch rate, yards
(`yards_gained` on completions), touchdowns (`pass_touchdown`),
interceptions, and EPA per target (`epa`, for passers too, so both grids
measure the same thing).

Every cell also carries the league's EPA per target in the same cell over
the previous regular season (and each file the league's share of targets
by depth band that season), a fixed baseline the site shades against:
deep passes gain far more EPA than screens, so a single midpoint would
describe the zone instead of the player. 2026 is compared with 2025 all
season, and a season's files are always compared with the season before.

A player's file is deleted only once a run has regular season data for a
season at least as new as the file's: last season's grids stay up through
the preseason (`stale_files`).
"""

import json
from collections import defaultdict

from common import DATA_DIR

LOCATIONS = ('left', 'middle', 'right')
# Top to bottom, as the site draws them.
DEPTHS = ('deep', 'intermediate', 'short', 'behind')

PBP_COLUMNS = [
    'game_id', 'week', 'season_type', 'pass_attempt', 'play_type', 'two_point_attempt', 'qb_spike',
    'sack', 'receiver_player_id', 'passer_player_id', 'pass_location', 'air_yards', 'complete_pass',
    'yards_gained', 'pass_touchdown', 'interception', 'epa',
]

FILTERS = [
    ('nullified by penalty', lambda p: p.get('play_type') != 'no_play'),
    ('two-point attempts', lambda p: not p.get('two_point_attempt')),
    ('spikes', lambda p: not p.get('qb_spike')),
    ('sacks', lambda p: not p.get('sack')),
    ('no receiver', lambda p: p.get('receiver_player_id') is not None),
    ('no pass location', lambda p: p.get('pass_location') in LOCATIONS),
    ('no air yards', lambda p: p.get('air_yards') is not None),
    ('no EPA', lambda p: p.get('epa') is not None),
]

TARGETS_DIR = 'targets'


def depth_band(air_yards: float) -> str:
    if air_yards < 0:
        return 'behind'
    if air_yards < 10:
        return 'short'
    if air_yards < 20:
        return 'intermediate'
    return 'deep'


def target_plays(plays: list[dict]) -> tuple[list[dict], list[tuple[str, int]]]:
    """The plays that count as targets, and how many plays each filter removed."""
    kept = [p for p in plays if p.get('pass_attempt') == 1]
    removed = [('not a pass play', len(plays) - len(kept))]
    for label, keep in FILTERS:
        before = len(kept)
        kept = [p for p in kept if keep(p)]
        removed.append((label, before - len(kept)))
    return kept, removed


def _empty() -> dict:
    return {'targets': 0, 'receptions': 0, 'yards': 0, 'touchdowns': 0, 'interceptions': 0, 'epa': 0.0}


def _add(tally: dict, p: dict) -> None:
    tally['targets'] += 1
    if p.get('complete_pass'):
        tally['receptions'] += 1
        tally['yards'] += int(p.get('yards_gained') or 0)
    tally['touchdowns'] += 1 if p.get('pass_touchdown') else 0
    tally['interceptions'] += 1 if p.get('interception') else 0
    tally['epa'] += p['epa']


def _stats(tally: dict) -> dict:
    n = tally['targets']
    return {
        'targets': n,
        'receptions': tally['receptions'],
        'catchRate': round(tally['receptions'] / n, 3) if n else None,
        'yards': tally['yards'],
        'touchdowns': tally['touchdowns'],
        'interceptions': tally['interceptions'],
        'epaPerTarget': round(tally['epa'] / n, 3) if n else None,
    }


def _cell_key(p: dict) -> tuple[str, str]:
    return p['pass_location'], depth_band(p['air_yards'])


def league_baseline(plays: list[dict]) -> dict[tuple[str, str], float | None]:
    """League EPA per target in each cell, from one season's target plays."""
    tallies = defaultdict(_empty)
    for p in plays:
        _add(tallies[_cell_key(p)], p)
    return {
        (location, depth): _stats(tallies[(location, depth)])['epaPerTarget']
        for depth in DEPTHS for location in LOCATIONS
    }


def league_depth_share(plays: list[dict]) -> dict[str, float] | None:
    """Share of one season's targets in each depth band, deep first."""
    if not plays:
        return None
    counts = defaultdict(int)
    for p in plays:
        counts[depth_band(p['air_yards'])] += 1
    return {depth: round(counts[depth] / len(plays), 3) for depth in DEPTHS}


def grid(plays: list[dict], baseline: dict[tuple[str, str], float | None]) -> dict:
    """The TargetGrid shape in src/data/types.ts: a total and all 12 cells,
    deep left first, empty cells included."""
    tallies = defaultdict(_empty)
    total = _empty()
    for p in plays:
        _add(tallies[_cell_key(p)], p)
        _add(total, p)
    return {
        'total': _stats(total),
        'cells': [
            {'location': location, 'depth': depth, **_stats(tallies[(location, depth)]),
             'leagueEpaPerTarget': baseline.get((location, depth))}
            for depth in DEPTHS for location in LOCATIONS
        ],
    }


def build_targets(plays: list[dict], season: int, through_week: int, baseline_plays: list[dict]) -> dict[str, dict]:
    """gsis id to the TargetsData shape in src/data/types.ts, for every
    player with at least one target or throw. `plays` are already target
    plays (target_plays); so are `baseline_plays`, from the season before."""
    baseline = league_baseline(baseline_plays) if baseline_plays else {}
    depth_share = league_depth_share(baseline_plays)
    by_receiver = defaultdict(list)
    by_passer = defaultdict(list)
    for p in plays:
        by_receiver[p['receiver_player_id']].append(p)
        if p.get('passer_player_id'):
            by_passer[p['passer_player_id']].append(p)
    return {
        player_id: {
            'season': season,
            'throughWeek': through_week,
            'playerId': player_id,
            'baselineSeason': season - 1 if baseline else None,
            'leagueDepthShare': depth_share,
            'targets': grid(by_receiver[player_id], baseline) if player_id in by_receiver else None,
            'throws': grid(by_passer[player_id], baseline) if player_id in by_passer else None,
        }
        for player_id in sorted(set(by_receiver) | set(by_passer))
    }


def stale_files(existing: dict[str, int], kept: set[str], season: int | None) -> list[str]:
    """Player ids whose files should go: not written this run, and from a
    season no newer than the one this run has regular season data for.

    `existing` maps each file's player id to its season; `season` is None
    when the run found no regular season plays at all, which deletes
    nothing, so last season's grids stay up until the new season's first
    games are in.
    """
    if season is None:
        return []
    return sorted(pid for pid, file_season in existing.items() if pid not in kept and file_season <= season)


def existing_files() -> dict[str, int]:
    folder = DATA_DIR / TARGETS_DIR
    if not folder.exists():
        return {}
    return {path.stem: json.loads(path.read_text(encoding='utf-8'))['season'] for path in folder.glob('*.json')}


def remove_files(player_ids: list[str]) -> None:
    for pid in player_ids:
        (DATA_DIR / TARGETS_DIR / f'{pid}.json').unlink()


def _select(frame, game_ids=None) -> list[dict]:
    import polars as pl

    if game_ids is not None:
        frame = frame.filter(pl.col('game_id').is_in(list(game_ids)))
    else:
        frame = frame.filter(pl.col('season_type') == 'REG')
    return frame.select([c for c in PBP_COLUMNS if c in frame.columns]).to_dicts()


def load_target_input(season: int, current_season: int, schedule_rows: list[dict]) -> tuple[list[dict], int, list[dict]]:
    """Every play of the final regular season games of `season`, the latest
    week among them, and every regular season play of the season before
    (for the baseline; empty if nflverse has none)."""
    from pbp_cache import load_pbp
    from team_stats import final_game_ids

    pbp = load_pbp(season, current_season)
    plays = []
    if pbp is not None:
        finals = final_game_ids(schedule_rows, season, set(pbp['game_id'].unique().to_list()))
        plays = _select(pbp, finals)
    previous = load_pbp(season - 1, current_season)
    baseline_plays = _select(previous) if previous is not None else []
    return plays, max((p['week'] for p in plays), default=0), baseline_plays
