"""Game day check for .github/workflows/gameday.yml: has nflverse
published a final that src/data/schedule.json does not have yet, and is
there a game worth waiting for?

The daily run updates records, standings and playoff odds once a morning,
so a game that ends Sunday afternoon would wait until Monday. On game days
the workflow runs this every few minutes and runs run_daily.py whenever a
new final appears. nflverse updates its schedule about every 10 to 30
minutes on game days, so a result reaches the site 15 to 45 minutes after
the final whistle, counting the deploy and GitHub Pages' 10 minute cache.
The live ticker shows the score itself the moment ESPN does.

The home page lays itself out for the moment the site was built in, and
leads with live 4th downs only while a game is on (homeState in
src/lib/home/state.ts: from LIVE_LEAD before a kickoff until the game is
final). A kickoff publishes no final, so the check also names the open game
window: the earliest kickoff among games in theirs. When that changes to a
new one, the workflow rebuilds the site, so the live layout is up when the
game starts; the final's rebuild takes it down. Near a kickoff the next check
is timed for the window's opening.

Run from the repo root:
    python pipelines/gameday.py
Prints one line, "<new finals> <watch 0|1> <seconds to wait> <window>", for
the workflow's shell loop; the window is a kickoff time, or "-" for none.
"""

import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import DATA_DIR  # noqa: E402
from schedule import build_schedule  # noqa: E402

# A game that kicked off longer ago than this and is still not final in
# nflverse is not going to be; stop waiting for it.
STALE_AFTER = timedelta(hours=8)
# Look this far ahead for kickoffs. Long enough that a run at 6 AM Eastern
# sees a Thursday or Monday night game (8:15 PM), short enough that the
# watch ends after Sunday night instead of idling into Monday.
AHEAD = timedelta(hours=16)
# Check often while a game is on, rarely while waiting for a kickoff.
LIVE_WAIT = 5 * 60
IDLE_WAIT = 15 * 60
# A game's window opens this long before kickoff: the home page's live layout
# (LIVE_LEAD in src/lib/home/state.ts, which must match).
LIVE_LEAD = timedelta(minutes=15)


def _final(game: dict) -> bool:
    return game['awayScore'] is not None and game['homeScore'] is not None


def _kickoff(game: dict) -> datetime | None:
    if not game['kickoff']:
        return None
    return datetime.fromisoformat(game['kickoff'].replace('Z', '+00:00'))


def check(latest: list[dict], committed: list[dict], now: datetime) -> tuple[list[str], bool, int]:
    """New finals (in latest, not final in committed), whether to keep
    watching, and how long to wait before the next check. Both lists are
    schedule.json games."""
    done = {g['id'] for g in committed if _final(g)}
    new = [g['id'] for g in latest if _final(g) and g['id'] not in done]
    kickoffs = [k for g in latest if not _final(g) and (k := _kickoff(g)) is not None]
    on = any(now - STALE_AFTER <= k <= now for k in kickoffs)
    coming = any(now < k <= now + AHEAD for k in kickoffs)
    wait = LIVE_WAIT if on else IDLE_WAIT
    # Wake for the next window's opening rather than up to 15 minutes after it.
    opening = [k - LIVE_LEAD for k in kickoffs if now < k - LIVE_LEAD]
    if opening:
        wait = max(60, min(wait, int((min(opening) - now).total_seconds())))
    return new, bool(new) or on or coming, wait


def window(latest: list[dict], now: datetime) -> str:
    """The earliest kickoff among games in their window (from LIVE_LEAD
    before kickoff, not final, not stale), as schedule.json writes it, or
    "-" when no game is."""
    open_ = sorted(g['kickoff'] for g in latest
                   if not _final(g) and (k := _kickoff(g)) is not None and k - LIVE_LEAD <= now <= k + STALE_AFTER)
    return open_[0] if open_ else '-'


def main() -> None:
    from ticker import load_schedule_rows
    from common import today_eastern

    committed = json.loads((DATA_DIR / 'schedule.json').read_text())
    latest = build_schedule(load_schedule_rows(today_eastern()), committed['season'], '')['games']
    now = datetime.now(timezone.utc)
    new, watch, wait = check(latest, committed['games'], now)
    print(f"{len(new)} {int(watch)} {wait} {window(latest, now)}")
    if new:
        print(f"new finals: {', '.join(new)}", file=sys.stderr)


if __name__ == '__main__':
    main()
