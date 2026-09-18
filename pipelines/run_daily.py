"""Daily site data job: writes ticker.json, leaders.json, stats/, rosters/ and
transactions.json into src/data/.

Run from the repo root:
    pip install -r pipelines/requirements.txt
    python pipelines/run_daily.py
Options:
    --today YYYY-MM-DD   pretend it is this US Eastern date (for testing)
    --dry-run            print the output instead of writing files

team_stats.json comes from the weekly job (run_weekly.py), which needs the
much larger play-by-play download. model_record.json and on_this_day.json
are not produced here: the model record waits on the 4th down model, which
is Tyler's to build.
"""

import argparse
import json
import sys
from datetime import date, datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import load_with_fallback, stats_season, today_eastern, write_json_if_changed  # noqa: E402
from leaderboards import build_leaderboards, load_player_week_rows  # noqa: E402
from leaders import build_leaders  # noqa: E402
from rosters import build_rosters, load_roster_rows, unknown_statuses  # noqa: E402
from ticker import build_ticker, load_schedule_rows  # noqa: E402
from transactions import (  # noqa: E402
    build_transactions,
    load_injury_rows,
    load_snap_shares,
    load_weekly_roster_rows,
)


def roster_season(today: date) -> int:
    # Rosters for a season are published in the spring, well before its
    # first game, so the new season takes over as soon as it has a file.
    return today.year if today.month >= 3 else today.year - 1


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--today', type=date.fromisoformat, default=None)
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    today = args.today or today_eastern()

    updated = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace('+00:00', 'Z')

    ticker = build_ticker(load_schedule_rows(today), today)
    player_rows, stats_year = load_with_fallback(load_player_week_rows, stats_season(today))
    leaders = build_leaders(player_rows, stats_year)
    boards = build_leaderboards(player_rows, stats_year)
    roster_rows, rosters_year = load_with_fallback(load_roster_rows, roster_season(today))
    rosters = build_rosters(roster_rows, rosters_year, today, updated)

    week = f"week {ticker['week']}" if ticker['week'] else f"offseason, opener {ticker['nextOpener']}"
    print(f"{today}: ticker {ticker['season']} {week}, {len(ticker['games'])} games")
    print(f"leaders: {leaders['season']} through week {leaders['throughWeek']}")
    print('boards: ' + ', '.join(f"{key} {len(board['rows'])}" for key, board in boards.items()))
    players = sum(len(r['players']) for r in rosters.values())
    print(f"rosters: {rosters_year} week {next(iter(rosters.values()))['week'] if rosters else 0}, "
          f"{len(rosters)} teams, {players} players")
    if ticker['week'] is None:
        transactions = build_transactions([], [], ticker['season'], None, updated)
    else:
        transactions = build_transactions(
            load_weekly_roster_rows(ticker['season']),
            load_injury_rows(ticker['season']),
            ticker['season'],
            ticker['week'],
            updated,
            load_snap_shares(ticker['season']),
        )
    print(f"transactions: week {transactions['movesWeek']} vs {transactions['comparedToWeek']}, "
          f"{len(transactions['moves'])} moves, {len(transactions['injuries'])} on the injury report")

    unknown = unknown_statuses(roster_rows)
    if unknown:
        print(f"rosters: WARNING unknown status codes left off rosters: {', '.join(sorted(unknown))}")

    files = [('ticker.json', ticker, ('updated',)), ('leaders.json', leaders, ())]
    files += [(f'stats/{key}.json', board, ()) for key, board in boards.items()]
    files.append(('transactions.json', transactions, ('updated',)))
    files += [(f'rosters/{team}.json', roster, ('updated',)) for team, roster in sorted(rosters.items())]

    if args.dry_run:
        print(json.dumps({name: data for name, data, _ in files}, indent=2))
        return

    written = 0
    for name, data, volatile in files:
        if write_json_if_changed(name, data, volatile):
            written += 1
            print(f'{name}: updated')
    print(f'{written} of {len(files)} files updated')


if __name__ == '__main__':
    main()
