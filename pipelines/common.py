"""Shared helpers for the site data pipelines."""

import json
import re
import unicodedata
from datetime import date, datetime
from pathlib import Path
from typing import Callable
from zoneinfo import ZoneInfo

DATA_DIR = Path(__file__).resolve().parent.parent / 'src' / 'data'

# NFL schedules and kickoff times are published in US Eastern time.
EASTERN = ZoneInfo('America/New_York')

# nflverse uses LA for the Rams; the site standardizes on LAR.
TEAM_ALIASES = {'LA': 'LAR'}


def normalize_team(abbr: str) -> str:
    return TEAM_ALIASES.get(abbr, abbr)


def today_eastern() -> date:
    return datetime.now(EASTERN).date()


def stats_season(today: date) -> int:
    """The season whose stats are current. A season runs September into
    February; early September, before the new season has any stats, loaders
    fall back to the previous one."""
    return today.year if today.month >= 9 else today.year - 1


def player_slug(name: str) -> str:
    """URL slug for a player name.

    Must stay in step with playerSlug in src/utils/slug.ts: accents are
    dropped, apostrophes and periods disappear rather than becoming
    separators, and every other run of punctuation or space becomes one
    dash. "Amon-Ra St. Brown" -> "amon-ra-st-brown", "Audric Estime"
    (with the accent) -> "audric-estime".
    """
    unaccented = ''.join(
        c for c in unicodedata.normalize('NFD', name) if not unicodedata.combining(c)
    )
    cleaned = re.sub(r"['.]", '', unaccented.lower())
    return re.sub(r'[^a-z0-9]+', '-', cleaned).strip('-')


def missing_season(error: Exception) -> bool:
    """True when nflreadpy reported that a season's file does not exist yet.

    nflverse publishes a file per season, and asking for one before its
    first data exists is a 404 that nflreadpy raises as a ConnectionError.
    Any other failure must stop the run rather than quietly publish stale
    data.
    """
    return isinstance(error, ConnectionError) and '404' in str(error)


def load_with_fallback(load: Callable[[int], list[dict]], season: int) -> tuple[list[dict], int]:
    """Load `season`, falling back to the one before it when nflverse has nothing yet.

    `load` returns an empty list for a season that has not been published.
    Returns the rows and the season they actually came from.
    """
    rows = load(season)
    if rows:
        return rows, season
    return load(season - 1), season - 1


def write_json_if_changed(name: str, data: dict, volatile_keys: tuple[str, ...] = ()) -> bool:
    """Write src/data/<name> unless only volatile keys (like a timestamp) changed.

    `name` may include a subdirectory, e.g. "rosters/BUF.json".

    Returns True when the file was written. Skipping timestamp-only changes
    keeps the daily job from committing and redeploying when nothing a
    visitor would see is different.
    """
    path = DATA_DIR / name
    if path.exists():
        existing = json.loads(path.read_text(encoding='utf-8'))
        strip = lambda d: {k: v for k, v in d.items() if k not in volatile_keys}
        if strip(existing) == strip(data):
            return False
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    return True
