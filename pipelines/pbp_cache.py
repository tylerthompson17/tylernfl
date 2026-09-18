"""Per-season play-by-play cache for the weekly jobs and, later, the 4th down model.

A completed season never changes, so it is downloaded once and kept for
good. The current season is refreshed whenever the cached copy is older
than CURRENT_SEASON_MAX_AGE, so a weekly run always sees new games while a
manual rerun the same morning reuses the download.

Files live in pipelines/.cache/pbp/ (gitignored), or PBP_CACHE_DIR if set.
In CI, .github/workflows/weekly.yml persists the directory between runs
with actions/cache.

nflreadpy has a cache of its own, but one expiry for every file: long enough
to keep past seasons would serve a stale current season.
"""

import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

from common import missing_season

CACHE_DIR = Path(os.environ.get('PBP_CACHE_DIR') or Path(__file__).resolve().parent / '.cache' / 'pbp')
CURRENT_SEASON_MAX_AGE = timedelta(hours=12)


def is_fresh(season: int, current_season: int, cached_at: datetime | None, now: datetime) -> bool:
    """Whether a cached season can be used as is. cached_at is None when there is no copy."""
    if cached_at is None:
        return False
    if season < current_season:
        return True
    return now - cached_at < CURRENT_SEASON_MAX_AGE


def cache_path(season: int) -> Path:
    return CACHE_DIR / f'pbp_{season}.parquet'


def load_pbp(season: int, current_season: int):
    """Full nflverse play-by-play for one season as a polars DataFrame.

    Returns None when nflverse has not published the season yet. Any other
    download failure raises, even with an older copy cached: a weekly job
    that quietly republished last week's numbers would look current.
    """
    import nflreadpy as nfl
    import polars as pl

    path = cache_path(season)
    cached_at = (
        datetime.fromtimestamp(path.stat().st_mtime, timezone.utc) if path.exists() else None
    )
    if is_fresh(season, current_season, cached_at, datetime.now(timezone.utc)):
        return pl.read_parquet(path)

    try:
        pbp = nfl.load_pbp(season)
    except ConnectionError as error:
        if missing_season(error):
            return None
        raise

    path.parent.mkdir(parents=True, exist_ok=True)
    # Write then rename, so an interrupted run never leaves a truncated file
    # that a later run would trust.
    partial = path.with_suffix('.parquet.partial')
    pbp.write_parquet(partial)
    partial.replace(path)
    return pbp
