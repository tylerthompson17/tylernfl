"""The auto chart: drawn daily by run_daily.py for the home page's chart
panel, shown only when no chart of Tyler's is marked featured. Every one
drawn is kept and listed in the /charts gallery beside Tyler's, tagged Auto.

Writes src/data/charts/archive/<slug>.{json,svg,hover.json}, one set per
chart, and src/data/charts/auto.json, which names today's. A chart's slug
says what it covers (auto-2026-week-2-ind-at-kc-win-probability), so a rerun,
or another day drawing the same template from the same week's data,
redraws that entry instead of adding a near copy.

Every final of the season gets a win probability chart. The archive is
filled in, not appended to: each run draws the games it has no chart for,
so a missed day catches up on its own and a new season fills in from its
first run. A game already drawn is never redrawn (delete its files to
have it drawn again). The site shows them on the team pages of the teams
that played; only the day's pick, below, reaches the gallery.

Which chart is today's, the one auto.json names and the home page shows:

- The morning after a game day, the best of that day's games: the one
  that stayed closest late and blew the biggest lead, scored by
  GAME_SCORE. It is timely, and only possible then. Games nflverse has
  not published play-by-play for yet are not candidates, and a day with
  none of them falls through to the templates below.
- Any other day, the date picks between the others that have enough data:
  offense vs defense EPA for every team (from team_stats.json), and a top 5
  race in passing, rushing or receiving yards (from the game logs, from
  week 4 on, when a race has a shape). The same date always gives the same
  chart, so a rerun changes nothing.

Everything is read from published nflverse data or from this site's own
data files. Win probability and EPA are nflfastR's values as published in
nflverse play-by-play, not a model of this site's, and the source line
says so. When Tyler's win probability model exists, the WP template should
switch to it.
"""

import json
from datetime import date, datetime, timedelta
from typing import Callable

from common import DATA_DIR, normalize_team

from charts import style

RACE_FROM_WEEK = 4
RACE_BOARDS = [
    ('passing', 'passing_yards', 'Passing yards'),
    ('rushing', 'rushing_yards', 'Rushing yards'),
    ('receiving', 'receiving_yards', 'Receiving yards'),
]


# ---------------------------------------------------------------- picking
#
# Which of a day's finals the win probability chart draws. Margin alone
# read the scoreboard and nothing else: on September 13 it ranked GB at
# MIN 10th of that day's 13 games, a 17-point final in which a team gave
# back a 91% lead. The score reads the shape of the game instead, from nflfastR's
# published win probability: how close it stayed when it mattered, and
# the biggest lead anyone handed back.

# "Late" is the last five minutes of regulation. Overtime is late all the
# way through, whatever its clock says.
LATE_SECONDS = 300

# The two halves of the score. Closeness leads: a game still in doubt at
# the end is the one worth replaying, and a collapse that ends in a
# comfortable win is a smaller story than one that does not.
LATE_WEIGHT = 0.6
COLLAPSE_WEIGHT = 0.4


def finals_on(schedule_rows: list[dict], day: date) -> list[dict]:
    """The games played on `day` that have a final score."""
    return [
        row for row in schedule_rows
        if row.get('gameday') == day.isoformat()
        and row.get('away_score') is not None and row.get('home_score') is not None
    ]


def kickoff_minutes(gametime: str | None) -> int:
    """Kickoff as minutes past midnight, for ordering a day's games."""
    hours, _, minutes = (gametime or '00:00').partition(':')
    return int(hours) * 60 + int(minutes or 0)


def doubt(wp: float) -> float:
    """1 where the game is a coin flip, 0 where it is decided."""
    return 1 - 2 * abs(wp - 0.5)


def late_doubt(plays: list[dict]) -> float:
    """How much the game was still in doubt late: the mean doubt over the
    plays in the last LATE_SECONDS of regulation and all of overtime. A
    game put away by the fourth quarter scores near 0 however wild the
    first three were."""
    late = [p for p in plays if p['qtr'] > 4 or p['game_seconds_remaining'] <= LATE_SECONDS]
    return sum(doubt(wp_after(p)) for p in late) / len(late) if late else 0.0


def collapse(plays: list[dict]) -> float:
    """The biggest lead blown: how likely a team was to win before giving
    it all the way back to even or worse, stretched so 50% is 0 and 100%
    is 1. A team that reached 95% and was level again later scores 0.90;
    a game where no lead was ever handed back scores 0. Either team can
    be the one that let it go.

    Measuring the fall itself instead would score every game the same:
    the losing team always ends at 0, having kicked off at about 50%.
    """
    worst = 0.0
    home = [wp_after(p) for p in plays]
    for series in (home, [1 - wp for wp in home]):
        peak = 0.0
        for wp in series:
            peak = max(peak, wp)
            if wp <= 0.5:
                worst = max(worst, 2 * (peak - 0.5))
    return worst


def drama(plays: list[dict]) -> float:
    """How worth watching one game was, 0 to 1."""
    return LATE_WEIGHT * late_doubt(plays) + COLLAPSE_WEIGHT * collapse(plays)


def late_drama(games: list[tuple[dict, list[dict]]]) -> dict[str, float]:
    """The default GAME_SCORE: a score per game_id, over (schedule row,
    its win probability plays) pairs."""
    return {row['game_id']: drama(plays) for row, plays in games}


# How a day's games are ranked: a function from the day's finals, each
# with its plays, to a score per game_id. The highest is drawn, and
# GAME_SCORE names the one in use. late_drama reads nflfastR's published
# win probability, the same numbers the chart itself draws, the way
# playoff_odds reads published betting lines; the weights above are a
# starting point, not a finding. A game rating of Tyler's replaces it,
# taking the same pairs and returning the same thing.
GAME_SCORE: Callable[[list[tuple[dict, list[dict]]]], dict[str, float]] = late_drama


def best_game(games: list[tuple[dict, list[dict]]],
              scores: dict[str, float]) -> tuple[dict, list[dict]] | None:
    """The day's highest scoring game with its plays. Ties go to the later
    kickoff, the one people stayed up for."""
    if not games:
        return None
    return max(
        games,
        key=lambda g: (scores.get(g[0]['game_id'], 0.0), kickoff_minutes(g[0].get('gametime'))),
    )


def other_templates(team_stats: dict | None, through_week: int) -> list[str]:
    """Templates with enough data on a day with no game the day before."""
    templates = []
    if team_stats and any(t['values'].get('off_epa', {}).get('value') is not None for t in team_stats['teams']):
        templates.append('epa')
    if through_week >= RACE_FROM_WEEK:
        templates.append('race')
    return templates


def pick_other(templates: list[str], today: date) -> str | None:
    """The date decides, so the same day always gets the same chart."""
    if not templates:
        return None
    return templates[today.toordinal() % len(templates)]


def race_board(today: date) -> tuple[str, str, str]:
    """Which yards race: shifts every other race day through the three."""
    return RACE_BOARDS[(today.toordinal() // 2) % len(RACE_BOARDS)]


# ---------------------------------------------------------------- the numbers


def elapsed_minutes(quarter: int, remaining: float) -> float:
    """Minutes since kickoff. nflfastR counts overtime's clock down from
    10:00 again, so overtime runs on from minute 60."""
    return ((3600 - remaining) if quarter <= 4 else (3600 + 600 - remaining)) / 60


def clock_label(quarter: float, remaining: float) -> str:
    """The game clock as a viewer saw it: "Q4 2:10", "OT 5:03". nflverse
    stores the quarter as a float, so it is made whole first (4.0 -> Q4)."""
    quarter = int(quarter)
    left = int(remaining - (4 - quarter) * 900) if quarter <= 4 else int(remaining)
    return f"{'OT' if quarter > 4 else f'Q{quarter}'} {left // 60}:{left % 60:02d}"


def wp_plays(plays: list[dict]) -> list[dict]:
    """Plays with a win probability, in the order they happened."""
    usable = [p for p in plays if None not in (p.get('home_wp'), p.get('game_seconds_remaining'), p.get('qtr'))]
    return sorted(usable, key=lambda p: p['play_id'])


def wp_after(play: dict) -> float:
    """Home win probability once the play is over. nflfastR's home_wp is
    before the snap; home_wp_post is after, missing on a few rows."""
    after = play.get('home_wp_post')
    return play['home_wp'] if after is None else after


def wp_points(plays: list[dict], away_score: int, home_score: int) -> list[tuple[float, float]]:
    """(minutes elapsed, home win probability) through the game, from
    wp_plays(), ending on the result. Each point is the probability after
    that play, so a swing shows at the play that caused it, where the hover
    readout names it, rather than at the next snap."""
    points = [(elapsed_minutes(p['qtr'], p['game_seconds_remaining']), wp_after(p)) for p in plays]
    if points:
        points.insert(0, (0.0, plays[0]['home_wp']))
    end = points[-1][0] if points else 60.0
    result = 1.0 if home_score > away_score else 0.0 if away_score > home_score else 0.5
    points.append((max(end, 60.0), result))
    return points


def winner_low(plays: list[dict], home_won: bool) -> tuple[float, dict]:
    """The winner's lowest win probability before the result, and the play
    it came after. The first low point wins a tie, the earliest scare."""
    lowest = min(plays, key=lambda p: p['home_wp'] if home_won else 1 - p['home_wp'])
    wp = lowest['home_wp'] if home_won else 1 - lowest['home_wp']
    return wp, lowest


def wp_note(game: dict, plays: list[dict]) -> str:
    """The result, then how close the winner came to losing it. Counting
    how often the favorite flipped reads badly: a close game crosses 50%
    on every small gain."""
    away, home = game['away_team'], game['home_team']
    a, h = game['away_score'], game['home_score']
    overtime = ' in overtime' if game.get('overtime') else ''
    if a == h:
        return f'{away} and {home} tied {a} to {h}{overtime}.'
    home_won = h > a
    winner, loser, w, l = (home, away, h, a) if home_won else (away, home, a, h)
    result = f'{winner} beat {loser} {w} to {l}{overtime}.'
    if not plays:
        return result
    low, play = winner_low(plays, home_won)
    percent = round(low * 100)
    if low > 0.5:
        return f'{result} {winner} was favored the whole way, never below {percent}%.'
    when = clock_label(play['qtr'], play['game_seconds_remaining'])
    return f"{result} {winner}'s chance fell as low as {percent}%, at {when}."


# ---------------------------------------------------------------- plays


def swing(play: dict) -> float:
    """How far the play moved the home team's win probability."""
    return wp_after(play) - play['home_wp']


def _yards(value) -> int:
    return int(value or 0)


def describe_play(play: dict) -> str:
    """What happened, in a few words, from nflverse's play fields rather
    than its play text, which runs long. Names come as nflverse writes
    them ("H.Butker"), the same style as the ticker."""
    passer, receiver = play.get('passer_player_name'), play.get('receiver_player_name')
    rusher, kicker = play.get('rusher_player_name'), play.get('kicker_player_name')
    kind = play.get('play_type')
    yards = _yards(play.get('yards_gained'))

    if play.get('interception'):
        catcher = play.get('interception_player_name')
        return f'{passer} intercepted by {catcher}' if passer and catcher else 'Interception'
    if play.get('fumble_lost'):
        fumbler = play.get('fumbled_1_player_name')
        return f'Fumble lost, {fumbler}' if fumbler else 'Fumble lost'
    if play.get('safety'):
        return 'Safety'
    if kind == 'field_goal':
        distance = _yards(play.get('kick_distance'))
        result = {'made': 'FG', 'missed': 'FG missed', 'blocked': 'FG blocked'}.get(play.get('field_goal_result'), 'FG')
        return f'{kicker} {distance} yd {result}' if kicker else f'{distance} yd {result}'
    if play.get('return_touchdown'):
        return 'Return TD'
    if play.get('sack'):
        return f'{passer} sacked' if passer else 'Sack'
    if play.get('fourth_down_failed'):
        return f"Stopped on 4th and {_yards(play.get('ydstogo'))}"

    touchdown = ' TD' if play.get('touchdown') else ''
    if kind == 'pass' and passer:
        if receiver and play.get('complete_pass', 1):
            return f'{passer} to {receiver}, {yards} yd{touchdown or "s"}'
        return f'{passer} incomplete'
    if kind == 'run' and rusher:
        return f'{rusher} {yards} yd{touchdown} run'
    if kind == 'punt':
        return 'Punt blocked' if play.get('punt_blocked') else 'Punt'
    if kind == 'kickoff':
        return 'Kickoff'
    if kind == 'extra_point':
        return 'Extra point' if play.get('extra_point_result') == 'good' else 'Extra point missed'
    if play.get('two_point_attempt'):
        return 'Two-point try good' if play.get('two_point_conv_result') == 'success' else 'Two-point try failed'
    if play.get('penalty') and play.get('penalty_type'):
        return f"Penalty, {play['penalty_type']}"
    if play.get('timeout'):
        team = play.get('timeout_team')
        return f'Timeout, {normalize_team(team)}' if team else 'Timeout'
    return (kind or 'Play').replace('_', ' ').capitalize()


def short_name(name: str) -> str:
    """First name to an initial, as the ticker does: "Ja'Marr Chase" -> "J.Chase"."""
    first, _, rest = name.partition(' ')
    return f'{first[0]}.{rest}' if rest else name


def race_series(logs: list[dict], board: str, column: str, top: int = 5) -> tuple[int, list[tuple[str, str, list[int]]]]:
    """Cumulative totals by week for the season's top players on a board.

    Returns (last week, [(name, team, running total per week 1..last)]),
    best first. The team is the one he is on now: game logs are filed under
    a player's current team, which is the logo shown. Each game is counted
    once even if a log appears in more than one file.
    """
    games: dict[str, dict[int, float]] = {}
    names: dict[str, str] = {}
    teams: dict[str, str] = {}
    last = 0
    for file in logs:
        keys = file['columns'].get(board, [])
        if column not in keys:
            continue
        index = 5 + keys.index(column)
        for player_id, player in file['players'].items():
            for row in player['boards'].get(board, []):
                week = row[0]
                games.setdefault(player_id, {})[week] = row[index] or 0
                names[player_id] = player['name']
                teams[player_id] = file['team']
                last = max(last, week)

    totals = sorted(games, key=lambda pid: (-sum(games[pid].values()), names[pid]))[:top]
    series = []
    for pid in totals:
        running, values = 0, []
        for week in range(1, last + 1):
            running += games[pid].get(week, 0)
            values.append(int(running))
        series.append((names[pid], teams[pid], values))
    return last, series


def race_note(label: str, series: list[tuple[str, str, list[int]]]) -> str:
    (leader, lead), (second, chase) = (series[0][0], series[0][2][-1]), (series[1][0], series[1][2][-1])
    gap = lead - chase
    if gap == 0:
        return f'{leader} and {second} are level at {lead:,} {label.lower()}.'
    return f'{leader} leads with {lead:,} {label.lower()}, {gap:,} ahead of {second}.'


def epa_note(team_stats: dict) -> str:
    teams = [t for t in team_stats['teams'] if t['values']['off_epa']['value'] is not None]
    best_off = max(teams, key=lambda t: t['values']['off_epa']['value'])
    best_def = min(teams, key=lambda t: t['values']['def_epa']['value'])
    # "Average" is the league mean, the same lines the chart draws.
    mean_off = sum(t['values']['off_epa']['value'] for t in teams) / len(teams)
    mean_def = sum(t['values']['def_epa']['value'] for t in teams) / len(teams)
    both = [t for t in teams if t['values']['off_epa']['value'] > mean_off and t['values']['def_epa']['value'] < mean_def]
    return (
        f"{best_off['abbr']} has the best offense by EPA per play ({signed3(best_off['values']['off_epa']['value'])}) "
        f"and {best_def['abbr']} the best defense ({signed3(best_def['values']['def_epa']['value'])}). "
        f"{len(both)} of {len(teams)} teams are above average on both sides."
    )


# ---------------------------------------------------------------- hover
#
# What the page shows under the pointer (style.save's hover). Built from
# the same numbers the chart draws, so the readout and the line agree.


def signed3(value: float) -> str:
    """+0.118 / −0.378: three places with a true minus, as the site writes
    signed stats (formatStat in src/utils/format.ts)."""
    return f'{value:+.3f}'.replace('-', '\u2212')


def _chance(home: str, away: str, home_wp: float) -> str:
    """"KC 64%": whoever is favored, and by how much. "Even" at 50%."""
    pct = round(max(home_wp, 1 - home_wp) * 100)
    if pct == 50:
        return 'Even'
    return f'{home if home_wp > 0.5 else away} {pct}%'


def wp_hover(game: dict, plays: list[dict], ax) -> dict:
    """Every play: the clock, who is favored after it, what happened, and
    the swing when it is at least 1%. Then the kickoff and the result."""
    home, away = game['home_team'], game['away_team']
    points = []
    if plays:
        points.append({'x': 0.0, 'y': plays[0]['home_wp'],
                       'lines': [f"Kickoff · {_chance(home, away, plays[0]['home_wp'])}"]})
    for play in plays:
        # nflverse's marker rows (game start, end of a quarter) are in the
        # line but are not plays: nothing to read out.
        if not play.get('play_type'):
            continue
        what = describe_play(play)
        if what == 'No play':
            continue  # a stoppage nflverse does not name
        after = wp_after(play)
        lines = [f"{clock_label(play['qtr'], play['game_seconds_remaining'])} · {_chance(home, away, after)}", what]
        change = swing(play)
        if abs(change) >= 0.005:
            lines.append(f"{home if change > 0 else away} +{round(abs(change) * 100)}% on the play")
        points.append({'x': elapsed_minutes(play['qtr'], play['game_seconds_remaining']), 'y': after, 'lines': lines})
    a, h = game['away_score'], game['home_score']
    end = max(60.0, points[-1]['x'] if points else 60.0)
    overtime = ' in overtime' if game.get('overtime') else ''
    if a == h:
        final = f'Final · {away} and {home} tied {a} to {h}{overtime}'
    else:
        winner, loser, w, l = (home, away, h, a) if h > a else (away, home, a, h)
        final = f'Final · {winner} beat {loser} {w} to {l}{overtime}'
    points.append({'x': end, 'y': 1.0 if h > a else 0.0 if a > h else 0.5, 'lines': [final]})
    return {'ax': ax, 'mode': 'x', 'points': points}


def _team_names() -> dict[str, str]:
    path = DATA_DIR / 'teams.json'
    return {t['abbr']: t['name'] for t in json.loads(path.read_text())} if path.exists() else {}


def ordinal(n: int) -> str:
    suffix = 'th' if 11 <= n % 100 <= 13 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')
    return f'{n}{suffix}'


def epa_hover(team_stats: dict, ax) -> dict:
    names = _team_names()
    points = []
    for t in team_stats['teams']:
        off, deff = t['values']['off_epa'], t['values']['def_epa']
        if off['value'] is None:
            continue
        points.append({'x': off['value'], 'y': deff['value'], 'lines': [
            names.get(t['abbr'], t['abbr']),
            f"Offense {signed3(off['value'])} EPA per play, {ordinal(off['rank'])} of 32",
            f"Defense {signed3(deff['value'])} allowed, {ordinal(deff['rank'])} of 32",
        ]})
    return {'ax': ax, 'mode': 'nearest', 'points': points}


def race_hover(label: str, last_week: int, series: list[tuple[str, str, list[int]]], ax) -> dict:
    points = []
    for week in range(1, last_week + 1):
        standing = sorted(((values[week - 1], name) for name, _, values in series), key=lambda r: (-r[0], r[1]))
        points.append({'x': week, 'y': None, 'lines': [f'Week {week}, {label.lower()} so far'] +
                       [f'{short_name(name)} {total:,}' for total, name in standing]})
    return {'ax': ax, 'mode': 'x', 'points': points}


# ---------------------------------------------------------------- drawing


def draw_wp(game: dict, points: list[tuple[float, float]], plays: list[dict] = ()):
    fig, ax = style.figure()
    away, home = game['away_team'], game['home_team']
    xs, ys = zip(*points)
    end = max(60.0, xs[-1])

    ax.axhline(0.5, color=style.RULE, linewidth=1)
    ax.step(xs, ys, where='post', color=style.HEADER)

    quarters = [0, 15, 30, 45, 60] + ([end] if end > 60 else [])
    ax.set_xticks(quarters)
    ax.set_xticklabels(['Kickoff', 'Q2', 'Q3', 'Q4', 'End'] + (['OT end'] if end > 60 else []))
    ax.set_xlim(0, end)
    ax.set_ylim(0, 1)
    ax.set_yticks([0, 0.25, 0.5, 0.75, 1])
    ax.set_yticklabels([f'{away} 100%', f'{away} 75%', '50%', f'{home} 75%', f'{home} 100%'])
    ax.grid(axis='x', visible=False)
    # Home wins at the top, away at the bottom: each logo at its own end.
    style.team_logo(ax, home, 0.03, 0.9, size_px=30, xycoords='axes fraction')
    style.team_logo(ax, away, 0.03, 0.1, size_px=30, xycoords='axes fraction')

    return fig, wp_hover(game, list(plays), ax)


def draw_race(label: str, last_week: int, series: list[tuple[str, str, list[int]]]):
    fig, ax = style.figure()
    weeks = list(range(1, last_week + 1))
    for (name, team, values), color in zip(series, style.SERIES):
        ax.plot(weeks, values, color=color)
    ax.set_xlim(1, last_week + 1.6)
    ax.set_xticks(weeks)
    ax.set_xlabel('Week')
    ax.set_ylabel(label)
    ax.set_ylim(bottom=0)
    # Close finishes would stack their labels; label_ends spaces them out.
    style.label_ends(ax, weeks[-1], [
        (values[-1], short_name(name), color, team)
        for (name, team, values), color in zip(series, style.SERIES)
    ])
    ax.yaxis.set_major_formatter(lambda v, _: f'{v:,.0f}')
    ax.spines['left'].set_visible(False)
    return fig, race_hover(label, last_week, series, ax)


def draw_epa(team_stats: dict):
    fig, ax = style.figure(height_px=480)
    teams = [t for t in team_stats['teams'] if t['values']['off_epa']['value'] is not None]
    xs = [t['values']['off_epa']['value'] for t in teams]
    ys = [t['values']['def_epa']['value'] for t in teams]
    mean_x, mean_y = sum(xs) / len(xs), sum(ys) / len(ys)

    ax.axvline(mean_x, color=style.RULE, linewidth=1)
    ax.axhline(mean_y, color=style.RULE, linewidth=1)
    # Logos are the markers. An invisible scatter still sets the axis range
    # (logos do not), padded so a logo at the edge is not cut off.
    ax.scatter(xs, ys, s=0)
    ax.margins(0.08)
    for team, x, y in zip(teams, xs, ys):
        style.team_logo(ax, team['abbr'], x, y, size_px=26)

    # Lower EPA allowed is better defense, so the axis runs downward: up
    # and to the right is good on both sides.
    ax.invert_yaxis()
    ax.set_xlabel('Offense EPA per play (right is better)')
    ax.set_ylabel('Defense EPA per play allowed (up is better)')
    corner = dict(fontsize=style.SMALL_PX, color=style.TEXT_DIM, transform=ax.transAxes)
    style.heading(ax, 'Good on both sides', xy=(0.99, 0.98), ha='right', va='top', **corner)
    style.heading(ax, 'Struggling on both', xy=(0.01, 0.02), ha='left', va='bottom', **corner)
    return fig, epa_hover(team_stats, ax)


# ---------------------------------------------------------------- the job

# Play-by-play fields the WP chart reads: the win probability before and
# after each play, and what describe_play() needs to say what happened.
PLAY_COLUMNS = [
    'game_id', 'play_id', 'qtr', 'game_seconds_remaining', 'home_wp', 'home_wp_post',
    'play_type', 'yards_gained', 'touchdown', 'return_touchdown', 'safety', 'sack',
    'interception', 'interception_player_name', 'fumble_lost', 'fumbled_1_player_name',
    'complete_pass', 'passer_player_name', 'receiver_player_name', 'rusher_player_name',
    'field_goal_result', 'kick_distance', 'kicker_player_name', 'extra_point_result',
    'two_point_attempt', 'two_point_conv_result', 'punt_blocked', 'fourth_down_failed',
    'ydstogo', 'penalty', 'penalty_type', 'timeout', 'timeout_team',
]


def _read(name: str):
    path = DATA_DIR / name
    return json.loads(path.read_text()) if path.exists() else None


def wp_plays_for(finals: list[dict], season: int,
                 current_season: int) -> list[tuple[dict, list[dict]]]:
    """Each of those finals that nflverse has play-by-play for, with its
    win probability plays, in the order given. A game is left out when the
    plays have not caught up: they arrive overnight, so a night game can
    be final in the schedule hours before nflverse publishes it."""
    if not finals:
        return []

    from pbp_cache import load_pbp

    pbp = load_pbp(season, current_season)
    if pbp is None:
        return []
    import polars as pl

    columns = [column for column in PLAY_COLUMNS if column in pbp.columns]
    rows = pbp.filter(pl.col('game_id').is_in([row['game_id'] for row in finals])).select(columns)
    by_game: dict[str, list[dict]] = {}
    for play in rows.to_dicts():
        by_game.setdefault(play['game_id'], []).append(play)

    candidates = ((row, wp_plays(by_game.get(row['game_id'], []))) for row in finals)
    return [(row, plays) for row, plays in candidates if plays]


def season_finals(schedule_rows: list[dict], season: int) -> list[dict]:
    """Every finished game of one season, regular and post, in kickoff order."""
    finals = [
        row for row in schedule_rows
        if row.get('season') == season
        and row.get('away_score') is not None and row.get('home_score') is not None
    ]
    return sorted(finals, key=lambda row: (row.get('gameday') or '', kickoff_minutes(row.get('gametime'))))


def drawn_slugs() -> set[str]:
    """The charts already in the archive."""
    archive = DATA_DIR / 'charts' / 'archive'
    return {
        path.name.removesuffix('.json') for path in archive.glob('*.json')
        if not path.name.endswith('.hover.json')
    } if archive.exists() else set()


def build_auto_charts(today: date, schedule_rows: list[dict], current_season: int):
    """(charts, slug of today's auto chart).

    The charts come as a generator: each figure is drawn as it is written,
    so only one is ever open. They are every game the archive is missing a
    win probability chart for, plus, on a day with no games yesterday, the
    EPA or race chart that stands in as today's.

    Reads the data files run_daily.py has just written.
    """
    drawn = drawn_slugs()
    yesterday = finals_on(schedule_rows, today - timedelta(days=1))
    missing = [game for game in season_finals(schedule_rows, current_season) if wp_slug(game) not in drawn]

    # One play-by-play load for both: yesterday's games decide today's
    # pick, the missing ones get drawn, and most days they are the same.
    # Kept in kickoff order, so a catch-up run draws the season in order.
    wanted = {game['game_id']: game for game in [*yesterday, *missing]}
    ordered = sorted(wanted.values(), key=lambda game: (game.get('gameday') or '', kickoff_minutes(game.get('gametime'))))
    played = wp_plays_for(ordered, current_season, current_season)

    pick, other = None, None
    yesterday_ids = {game['game_id'] for game in yesterday}
    candidates = [pair for pair in played if pair[0]['game_id'] in yesterday_ids]
    if candidates:
        pick = wp_slug(best_game(candidates, GAME_SCORE(candidates))[0])
    else:
        other = _other_chart(today)
        pick = other[2] if other else None

    def charts():
        if other is not None:
            yield other
        for game, plays in played:
            if wp_slug(game) not in drawn:
                yield _wp_chart(game, plays, pick=wp_slug(game) == pick)

    return charts(), pick


def _other_chart(today: date):
    """The chart for a day with no game the day before."""
    team_stats = _read('team_stats.json')
    receiving = _read('stats/receiving.json') or {}
    template = pick_other(other_templates(team_stats, receiving.get('throughWeek') or 0), today)
    if template == 'epa':
        return _epa_chart(team_stats, today)
    if template == 'race':
        return _race_chart(today)
    return None


def wp_slug(game: dict) -> str:
    """The archive name for a game's win probability chart. nflverse
    schedules call the Rams LA; the site's logos and pages say LAR."""
    away, home = normalize_team(game['away_team']), normalize_team(game['home_team'])
    return f"auto-{game['season']}-week-{game['week']}-{away}-at-{home}-win-probability".lower()


def _wp_chart(game: dict, plays: list[dict], pick: bool = True):
    game = {**game, 'away_team': normalize_team(game['away_team']), 'home_team': normalize_team(game['home_team'])}
    points = wp_points(plays, game['away_score'], game['home_score'])
    day = datetime.fromisoformat(game['gameday'])
    meta = {
        'template': 'wp',
        'title': f"Win probability, {game['away_team']} at {game['home_team']}",
        'note': wp_note(game, plays),
        'asOf': f'{day:%a}, {day:%b} {day.day}',
        'source': 'nflverse play-by-play, win probability from the nflfastR model',
        'date': game['gameday'],
        'tags': ['Auto', 'Win probability'],
        'teams': [game['away_team'], game['home_team']],
        'pick': pick,
    }
    fig, hover = draw_wp(game, points, plays)
    return meta, fig, wp_slug(game), hover


def _epa_chart(team_stats: dict, today: date):
    meta = {
        'template': 'epa',
        'title': 'Offense and defense, EPA per play',
        'note': epa_note(team_stats),
        'asOf': f"{team_stats['season']} season, through week {team_stats['throughWeek']}",
        'source': 'nflverse play-by-play, EPA from the nflfastR model',
        'date': today.isoformat(),
        'tags': ['Auto', 'EPA'],
        'pick': True,
    }
    fig, hover = draw_epa(team_stats)
    return meta, fig, f"auto-{team_stats['season']}-week-{team_stats['throughWeek']}-offense-defense-epa", hover


def _race_chart(today: date):
    board, column, label = race_board(today)
    logs = [json.loads(p.read_text()) for p in sorted((DATA_DIR / 'players').glob('*.json'))]
    last, series = race_series(logs, board, column)
    if len(series) < 2:
        return None
    season = logs[0]['season']
    meta = {
        'template': 'race',
        'title': f'{label}, the top 5 week by week',
        'note': race_note(label, series),
        'asOf': f'{season} season, through week {last}',
        'source': 'nflverse weekly player stats',
        'date': today.isoformat(),
        'tags': ['Auto', 'Yards race'],
        'pick': True,
    }
    fig, hover = draw_race(label, last, series)
    return meta, fig, f'auto-{season}-week-{last}-{board}-yards-race', hover


def write_auto_chart(chart) -> bool:
    """Write one chart to src/data/charts/archive/. True when any file
    changed.

    A redrawn entry keeps the date it was first drawn on, so the gallery's
    order does not shift when the same week's chart comes round again, and
    it stays a pick if it ever was one: being the day's chart is part of
    that day, not something a later run takes away.
    """
    from common import write_json_if_changed

    if chart is None:
        return False
    meta, fig, slug, hover = chart
    archive = DATA_DIR / 'charts' / 'archive'
    files = [archive / f'{slug}{ext}' for ext in ('.svg', '.hover.json')]
    before = [f.read_text() if f.exists() else None for f in files]
    style.save(fig, slug, archive, hover=hover)
    after = [f.read_text() if f.exists() else None for f in files]

    entry = archive / f'{slug}.json'
    if entry.exists():
        kept = json.loads(entry.read_text())
        meta = {**meta, 'date': kept['date'], 'pick': meta.get('pick', False) or kept.get('pick', True)}
    changed = write_json_if_changed(f'charts/archive/{slug}.json', meta)
    return changed or before != after


def write_charts(charts, pick: str | None) -> tuple[int, int]:
    """Write every chart and point src/data/charts/auto.json at today's.
    (how many were written, how many changed anything on disk)."""
    from common import write_json_if_changed

    written = changed = 0
    for chart in charts:
        written += 1
        changed += 1 if write_auto_chart(chart) else 0
    if pick:
        changed += 1 if write_json_if_changed('charts/auto.json', {'slug': pick}) else 0
    return written, changed
