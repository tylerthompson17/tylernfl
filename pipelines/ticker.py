"""Build src/data/ticker.json: one full NFL week of games from nflverse schedules.

Which week to show, by US Eastern date:
- Tuesday: the week that just ended.
- Wednesday through Monday: the upcoming (or in progress) week.
- Offseason (after the Super Bowl until the opener's week): no games, plus
  next season's opening date when the schedule has been released.

The daily run cannot see games in progress, so it never writes the "live"
state; scores appear once nflverse marks a game final.
"""

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

from common import EASTERN, normalize_team

TUESDAY = 1
WEDNESDAY = 2


@dataclass(frozen=True)
class WeekSpan:
    season: int
    week: int
    first_day: date
    last_day: date
    # The season's final week (Super Bowl). Once it has been played, the
    # offseason starts.
    is_season_finale: bool


def select_week(weeks: list[WeekSpan], today: date) -> WeekSpan | None:
    """Pick the week to display, or None for the offseason."""
    weeks = sorted(weeks, key=lambda w: (w.first_day, w.season, w.week))

    if today.weekday() == TUESDAY:
        # A week with a game today (rare Tuesday games) is still going.
        in_progress = [w for w in weeks if w.first_day < today <= w.last_day]
        if in_progress:
            return in_progress[0]
        just_ended = [w for w in weeks if today - timedelta(days=7) <= w.last_day < today]
        if just_ended:
            return max(just_ended, key=lambda w: w.last_day)
        anchor = today
    else:
        # Most recent Wednesday, which starts the NFL week for display.
        anchor = today - timedelta(days=(today.weekday() - WEDNESDAY) % 7)

    upcoming = [w for w in weeks if w.first_day >= anchor]
    if upcoming:
        nxt = upcoming[0]
        opener_too_far = nxt.week == 1 and (nxt.first_day - anchor).days > 6
        if not opener_too_far:
            return nxt

    # Playoff games are added to the schedule only once matchups are set.
    # Until the next round appears, keep showing the round that just ended.
    recent = [
        w
        for w in weeks
        if w.last_day < today and (today - w.last_day).days <= 14 and not w.is_season_finale
    ]
    if recent:
        return max(recent, key=lambda w: w.last_day)

    return None


def next_opener(weeks: list[WeekSpan], today: date) -> WeekSpan | None:
    openers = [w for w in weeks if w.week == 1 and w.first_day > today]
    return min(openers, key=lambda w: w.first_day) if openers else None


def format_detail(game: dict) -> str:
    """Status text for one game: "Final", "Final/OT", "Sun 1:00 PM", "Sat TBD"."""
    if game['away_score'] is not None and game['home_score'] is not None:
        return 'Final/OT' if game.get('overtime') == 1 else 'Final'
    day = date.fromisoformat(game['gameday']).strftime('%a')
    if not game.get('gametime'):
        return f'{day} TBD'
    kickoff = datetime.strptime(game['gametime'], '%H:%M')
    hour = kickoff.hour % 12 or 12
    meridiem = 'AM' if kickoff.hour < 12 else 'PM'
    return f'{day} {hour}:{kickoff.minute:02d} {meridiem}'


def kickoff_utc(game: dict) -> str | None:
    """Kickoff as ISO 8601 UTC ("2026-09-18T00:15:00Z"). nflverse times are US Eastern."""
    if not game.get('gametime'):
        return None
    local = datetime.strptime(f"{game['gameday']} {game['gametime']}", '%Y-%m-%d %H:%M').replace(tzinfo=EASTERN)
    return local.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def build_week_spans(games: list[dict]) -> list[WeekSpan]:
    by_week: dict[tuple[int, int], list[dict]] = {}
    for g in games:
        by_week.setdefault((g['season'], g['week']), []).append(g)
    spans = []
    for (season, week), week_games in by_week.items():
        days = [date.fromisoformat(g['gameday']) for g in week_games]
        spans.append(
            WeekSpan(
                season=season,
                week=week,
                first_day=min(days),
                last_day=max(days),
                is_season_finale=any(g['game_type'] == 'SB' for g in week_games),
            )
        )
    return spans


def build_ticker(games: list[dict], today: date) -> dict:
    """Pure function from schedule rows to the TickerData shape in src/data/types.ts."""
    weeks = build_week_spans(games)
    selected = select_week(weeks, today)
    updated = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')

    if selected is None:
        opener = next_opener(weeks, today)
        last_season = max((w.season for w in weeks), default=today.year - 1)
        return {
            'updated': updated,
            'season': opener.season if opener else last_season + 1,
            'week': None,
            'nextOpener': opener.first_day.isoformat() if opener else None,
            'games': [],
        }

    week_games = sorted(
        (g for g in games if g['season'] == selected.season and g['week'] == selected.week),
        key=lambda g: (g['gameday'], g.get('gametime') or '99:99', g['game_id']),
    )
    return {
        'updated': updated,
        'season': selected.season,
        'week': selected.week,
        'nextOpener': None,
        'games': [
            {
                'id': g['game_id'],
                'away': normalize_team(g['away_team']),
                'home': normalize_team(g['home_team']),
                'awayScore': g['away_score'],
                'homeScore': g['home_score'],
                'state': 'final' if g['away_score'] is not None and g['home_score'] is not None else 'pre',
                'detail': format_detail(g),
                'kickoff': kickoff_utc(g),
                # ESPN event id as recorded by nflverse; the browser uses it to
                # match live scores. No ESPN data is fetched here.
                'espnId': g.get('espn') or None,
            }
            for g in week_games
        ],
    }


def load_schedule_rows(today: date) -> list[dict]:
    import nflreadpy as nfl

    # Around the opener the "current season" can still be last year, and the
    # offseason needs next year's schedule for the opening date.
    seasons = [today.year - 1, today.year, today.year + 1]
    schedules = nfl.load_schedules(seasons)
    columns = [
        'game_id', 'season', 'game_type', 'week', 'gameday', 'gametime',
        'away_team', 'away_score', 'home_team', 'home_score', 'overtime', 'espn',
    ]
    return schedules.select(columns).drop_nulls(['gameday']).to_dicts()
