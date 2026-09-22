"""Daily site data job: writes ticker.json, stats/, players/,
rosters/, transactions.json, on_this_day.json, standings.json,
schedule.json and playoff_odds.json into
src/data/, then draws
the home page's auto chart (charts/auto.svg and charts/auto.json) from them.

Run from the repo root:
    pip install -r pipelines/requirements.txt
    python pipelines/run_daily.py
Options:
    --today YYYY-MM-DD   pretend it is this US Eastern date (for testing)
    --dry-run            print the output instead of writing files

team_stats.json comes from the weekly job (run_weekly.py), which needs the
much larger play-by-play download.
"""

import argparse
import json
import sys
from datetime import date, datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import load_with_fallback, stats_season, today_eastern, write_json_if_changed  # noqa: E402
from charts.auto import build_auto_chart, write_auto_chart  # noqa: E402
from game_logs import build_game_logs  # noqa: E402
from leaderboards import build_leaderboards, load_player_week_rows  # noqa: E402
from on_this_day import build_on_this_day, load_on_this_day_input  # noqa: E402
from rosters import build_rosters, load_roster_rows, unknown_statuses  # noqa: E402
from playoff_odds import build_playoff_odds  # noqa: E402
from schedule import build_schedule  # noqa: E402
from standings import build_standings  # noqa: E402
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

    schedule_rows = load_schedule_rows(today)
    ticker = build_ticker(schedule_rows, today)
    player_rows, stats_year = load_with_fallback(load_player_week_rows, stats_season(today))
    boards = build_leaderboards(player_rows, stats_year)
    game_logs = build_game_logs(player_rows, schedule_rows, stats_year)
    roster_rows, rosters_year = load_with_fallback(load_roster_rows, roster_season(today))
    rosters = build_rosters(roster_rows, rosters_year, today, updated)

    week = f"week {ticker['week']}" if ticker['week'] else f"offseason, opener {ticker['nextOpener']}"
    print(f"{today}: ticker {ticker['season']} {week}, {len(ticker['games'])} games")
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
            {team for game in ticker['games'] if game['state'] == 'final' for team in (game['away'], game['home'])},
        )
    print(f"transactions: week {transactions['movesWeek']} vs {transactions['comparedToWeek']}, "
          f"{len(transactions['moves'])} moves, {len(transactions['injuries'])} on the injury report")

    standings = build_standings(schedule_rows, stats_season(today), updated)
    # The ticker's season: in the offseason, the coming one once published.
    schedule = build_schedule(schedule_rows, ticker['season'], updated)
    print(f"schedule: {schedule['season']}, {len(schedule['games'])} games")
    odds = build_playoff_odds(schedule_rows, schedule['season'], updated)
    print(f"playoff odds: {odds['simulations']} simulations, {odds['pricedGames']} of "
          f"{odds['remainingGames']} remaining games priced by betting lines")
    top_seeds = [t['team'] for t in standings['teams'] if t['conferenceRank'] == 1]
    print(f"standings: {standings['season']} through week {standings['throughWeek']}, top seeds {', '.join(top_seeds)}")

    on_this_day = build_on_this_day(*load_on_this_day_input(), today)
    print(f"on this day: {today:%m-%d}, {len(on_this_day['items'])} of {on_this_day['gamesOnDate']} games")

    unknown = unknown_statuses(roster_rows)
    if unknown:
        print(f"rosters: WARNING unknown status codes left off rosters: {', '.join(sorted(unknown))}")

    files = [('ticker.json', ticker, ('updated',))]
    files += [(f'stats/{key}.json', board, ()) for key, board in boards.items()]
    logs = [(f'players/{team}.json', data, ()) for team, data in sorted(game_logs.items())]
    files.append(('transactions.json', transactions, ('updated',)))
    files.append(('on_this_day.json', on_this_day, ()))
    files.append(('standings.json', standings, ('updated',)))
    files.append(('schedule.json', schedule, ('updated',)))
    files.append(('playoff_odds.json', odds, ('updated',)))
    files += [(f'rosters/{team}.json', roster, ('updated',)) for team, roster in sorted(rosters.items())]

    if args.dry_run:
        print(json.dumps({name: data for name, data, _ in files + logs}, indent=2))
        return

    written = 0
    for name, data, volatile in files:
        if write_json_if_changed(name, data, volatile):
            written += 1
            print(f'{name}: updated')
    # Game logs are the one large set of files; they are written compactly.
    for name, data, volatile in logs:
        if write_json_if_changed(name, data, volatile, compact=True):
            written += 1
    print(f'{written} of {len(files) + len(logs)} files updated')

    # Drawn last: it reads the files just written (boards, game logs) and
    # team_stats.json from the weekly job.
    chart = build_auto_chart(today, schedule_rows, stats_season(today))
    if chart is None:
        print('auto chart: nothing to draw, keeping the last one')
    else:
        changed = write_auto_chart(chart)
        print(f"auto chart: {chart[0]['template']}, {'updated' if changed else 'unchanged'}")


if __name__ == '__main__':
    main()
