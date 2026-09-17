"""Daily site data job: writes ticker.json and leaders.json into src/data/.

Run from the repo root:
    pip install -r pipelines/requirements.txt
    python pipelines/run_daily.py
Options:
    --today YYYY-MM-DD   pretend it is this US Eastern date (for testing)
    --dry-run            print the output instead of writing files

model_record.json and on_this_day.json are not produced here: the model
record waits on the 4th down model, which is Tyler's to build.
"""

import argparse
import json
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import today_eastern, write_json_if_changed  # noqa: E402
from leaders import build_leaders, load_leaders_input  # noqa: E402
from ticker import build_ticker, load_schedule_rows  # noqa: E402


def leaders_season(today: date) -> int:
    # A season runs September into February. Early September, before the new
    # season has any stats, load_leaders_input falls back to last season.
    return today.year if today.month >= 9 else today.year - 1


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--today', type=date.fromisoformat, default=None)
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    today = args.today or today_eastern()

    ticker = build_ticker(load_schedule_rows(today), today)
    leader_rows, season = load_leaders_input(leaders_season(today))
    leaders = build_leaders(leader_rows, season)

    week = f"week {ticker['week']}" if ticker['week'] else f"offseason, opener {ticker['nextOpener']}"
    print(f"{today}: ticker {ticker['season']} {week}, {len(ticker['games'])} games")
    print(f"leaders: {leaders['season']} through week {leaders['throughWeek']}")

    if args.dry_run:
        print(json.dumps({'ticker': ticker, 'leaders': leaders}, indent=2))
        return

    for name, data, volatile in (
        ('ticker.json', ticker, ('updated',)),
        ('leaders.json', leaders, ()),
    ):
        changed = write_json_if_changed(name, data, volatile)
        print(f"{name}: {'updated' if changed else 'unchanged'}")


if __name__ == '__main__':
    main()
