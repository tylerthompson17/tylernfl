"""Weekly site data job: writes team_stats.json and player_epa.json into
src/data/, both from play-by-play.

Runs Wednesday morning from .github/workflows/weekly.yml, once Monday night
games are final in nflverse play-by-play. Team stats only change after
games, so a daily run would redo the download for nothing.

Run from the repo root:
    pip install -r pipelines/requirements.txt
    python pipelines/run_weekly.py
Options:
    --today YYYY-MM-DD   pretend it is this US Eastern date (for testing)
    --dry-run            print the output instead of writing files
"""

import argparse
import json
import sys
from datetime import date, datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import load_with_fallback, stats_season, today_eastern, write_json_if_changed  # noqa: E402
from pbp_cache import CACHE_DIR  # noqa: E402
from player_epa import build_player_epa, load_player_epa_plays  # noqa: E402
from team_stats import build_team_stats, load_team_stats_rows  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--today', type=date.fromisoformat, default=None)
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    today = args.today or today_eastern()
    updated = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace('+00:00', 'Z')

    current = stats_season(today)
    rows, season = load_with_fallback(lambda s: load_team_stats_rows(s, current), current)
    team_stats = build_team_stats(rows, season, updated)

    print(f"{today}: team stats {season} through week {team_stats['throughWeek']}, "
          f"{len(team_stats['teams'])} teams, {len(rows)} plays (cache: {CACHE_DIR})")

    # Same season as team stats, so the two never disagree about the week.
    plays, through = load_player_epa_plays(season, current)
    player_epa = build_player_epa(plays, season, through, updated)
    print('player EPA: ' + ', '.join(f"{c['key']} {len(c['rows'])} qualified" for c in player_epa['categories']))

    if args.dry_run:
        print(json.dumps({'team_stats': team_stats, 'player_epa': player_epa}, indent=2))
        return

    for name, data in (('team_stats.json', team_stats), ('player_epa.json', player_epa)):
        changed = write_json_if_changed(name, data, ('updated',))
        print(f"{name}: {'updated' if changed else 'unchanged'}")


if __name__ == '__main__':
    main()
