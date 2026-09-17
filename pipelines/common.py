"""Shared helpers for the site data pipelines."""

import json
from datetime import date, datetime
from pathlib import Path
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


def write_json_if_changed(name: str, data: dict, volatile_keys: tuple[str, ...] = ()) -> bool:
    """Write src/data/<name> unless only volatile keys (like a timestamp) changed.

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
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    return True
