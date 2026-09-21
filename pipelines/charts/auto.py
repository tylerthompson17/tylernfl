"""The auto chart: drawn daily by run_daily.py for the home page's chart
panel, shown only when no chart of Tyler's is marked featured. It never
appears in the /charts gallery, which is Tyler's charts only.

Writes src/data/charts/auto.svg and src/data/charts/auto.json.

Which template runs:

- The morning after a game day, win probability of that day's closest game
  (smallest final margin; ties go to the later kickoff). It is timely, and
  only possible then. Skipped if nflverse has not published that game's
  play-by-play yet.
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

from common import DATA_DIR

from charts import style

RACE_FROM_WEEK = 4
RACE_BOARDS = [
    ('passing', 'passing_yards', 'Passing yards'),
    ('rushing', 'rushing_yards', 'Rushing yards'),
    ('receiving', 'receiving_yards', 'Receiving yards'),
]


# ---------------------------------------------------------------- picking


def closest_game(schedule_rows: list[dict], day: date) -> dict | None:
    """The final game on `day` with the smallest margin; ties go to the
    later kickoff, the one people stayed up for."""
    finals = [
        row for row in schedule_rows
        if row.get('gameday') == day.isoformat()
        and row.get('away_score') is not None and row.get('home_score') is not None
    ]
    if not finals:
        return None
    return min(
        finals,
        key=lambda r: (abs(r['away_score'] - r['home_score']), _minus_time(r.get('gametime'))),
    )


def _minus_time(gametime: str | None) -> int:
    hours, _, minutes = (gametime or '00:00').partition(':')
    return -(int(hours) * 60 + int(minutes or 0))


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
    that play, so a swing shows at the play that caused it, where its label
    points, rather than at the next snap."""
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


# ---------------------------------------------------------------- key plays

# The swings worth a label: a few, spread across the game. A close finish
# puts its biggest swings together (IND at KC had five of its six biggest
# in overtime), and labels stacked in one corner read worse than a missing
# one. The winner's lowest point is in the note either way.
KEY_PLAYS = 3
KEY_PLAY_GAP_MINUTES = 8


def swing(play: dict) -> float:
    """How far the play moved the home team's win probability."""
    return wp_after(play) - play['home_wp']


def key_plays(plays: list[dict], limit: int = KEY_PLAYS, gap: float = KEY_PLAY_GAP_MINUTES) -> list[dict]:
    """The biggest swings, largest first, each at least `gap` game minutes
    from any already picked. Returned in game order, for drawing."""
    picked: list[dict] = []
    for play in sorted(plays, key=lambda p: (-abs(swing(p)), p['play_id'])):
        if len(picked) == limit or abs(swing(play)) == 0:
            break
        at = elapsed_minutes(play['qtr'], play['game_seconds_remaining'])
        if all(abs(at - elapsed_minutes(p['qtr'], p['game_seconds_remaining'])) >= gap for p in picked):
            picked.append(play)
    return sorted(picked, key=lambda p: p['play_id'])


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
    return (kind or 'Play').replace('_', ' ').capitalize()


def label_bands(spans: list[tuple[float, float]], points: list[tuple[float, float]], height: float,
                blocked: dict[str, list[tuple[float, float]]] | None = None) -> list[str]:
    """For each label, 'top' or 'bottom': the band along that edge of the
    chart it sits in, clear of the line and of the other labels.

    spans are each label's left and right edge in game minutes, in game
    order. height is a label's height as a fraction of the axes. A band is
    clear when the line stays out of it across the label's whole width;
    between two clear bands (or two blocked ones) the one with more room
    wins. A band another label already holds there is taken only if both
    are held. blocked adds spans already taken in a band, such as a logo.
    """
    taken = {'top': list((blocked or {}).get('top', [])), 'bottom': list((blocked or {}).get('bottom', []))}
    bands = []
    for x0, x1 in spans:
        values = [wp for x, wp in points if x0 <= x <= x1] or [0.5]
        # Room between the line and each band's inner edge (margin 0.03).
        room = {'top': (0.97 - height) - max(values), 'bottom': min(values) - (0.03 + height)}
        free = [band for band in ('top', 'bottom') if not any(a < x1 and x0 < b for a, b in taken[band])]
        choices = free or ['top', 'bottom']
        band = max(choices, key=lambda b: (room[b] > 0, room[b]))
        taken[band].append((x0, x1))
        bands.append(band)
    return bands


def play_label(play: dict, home: str, away: str) -> list[str]:
    """The callout's two lines: when and who gained how much, then what
    happened. "OT 5:13, KC +53%" / "H.Butker 31 yd FG"."""
    change = swing(play)
    team = home if change > 0 else away
    when = clock_label(play['qtr'], play['game_seconds_remaining'])
    return [f'{when}, {team} +{round(abs(change) * 100)}%', describe_play(play)]


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
        f"{best_off['abbr']} has the best offense by EPA per play ({best_off['values']['off_epa']['value']:+.3f}) "
        f"and {best_def['abbr']} the best defense ({best_def['values']['def_epa']['value']:+.3f}). "
        f"{len(both)} of {len(teams)} teams are above average on both sides."
    )


# ---------------------------------------------------------------- drawing


def draw_wp(game: dict, points: list[tuple[float, float]], moments: list[dict] = ()):
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

    place_callouts(ax, points, [
        (elapsed_minutes(play['qtr'], play['game_seconds_remaining']), wp_after(play), play_label(play, home, away))
        for play in moments
    ])
    return fig


def place_callouts(ax, points: list[tuple[float, float]], moments: list[tuple[float, float, list[str]]]) -> None:
    """Callouts in the bands along the top and bottom edges, each where the
    line leaves room, with a leader down or up to its play. The logos at
    the left end of each band are kept clear."""
    fig = ax.figure
    fig.draw_without_rendering()
    box = ax.get_window_extent()
    x_min, x_max = ax.get_xlim()
    per_px = (x_max - x_min) / box.width
    height = (2 * (style.SMALL_PX + 4) + 8) / box.height

    spans = []
    for x, _, lines in moments:
        width = style.callout_width_px(lines) * per_px
        align = style.callout_align((x - x_min) / (x_max - x_min))
        spans.append((x - width * align, x + width * (1 - align)))
    logo = (x_min, x_min + 0.08 * (x_max - x_min))
    bands = label_bands(spans, points, height, {'top': [logo], 'bottom': [logo]})
    for (x, y, lines), band in zip(moments, bands):
        style.callout(ax, x, y, lines, label_y=0.97 if band == 'top' else 0.03)


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
    return fig


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
    return fig


# ---------------------------------------------------------------- the job

# Play-by-play fields the WP chart reads: the win probability before and
# after each play, and what describe_play() needs to say what happened.
PLAY_COLUMNS = [
    'play_id', 'qtr', 'game_seconds_remaining', 'home_wp', 'home_wp_post',
    'play_type', 'yards_gained', 'touchdown', 'return_touchdown', 'safety', 'sack',
    'interception', 'interception_player_name', 'fumble_lost', 'fumbled_1_player_name',
    'complete_pass', 'passer_player_name', 'receiver_player_name', 'rusher_player_name',
    'field_goal_result', 'kick_distance', 'kicker_player_name', 'extra_point_result',
    'two_point_attempt', 'two_point_conv_result', 'punt_blocked', 'fourth_down_failed',
    'ydstogo', 'penalty', 'penalty_type',
]


def _read(name: str):
    path = DATA_DIR / name
    return json.loads(path.read_text()) if path.exists() else None


def build_auto_chart(today: date, schedule_rows: list[dict], current_season: int):
    """(meta, figure, slug) for today's auto chart, or None when there is
    nothing to draw. Reads the data files run_daily.py has just written."""
    game = closest_game(schedule_rows, today - timedelta(days=1))
    if game:
        chart = _wp_chart(game, current_season)
        if chart:
            return chart

    team_stats = _read('team_stats.json')
    leaders = _read('leaders.json') or {}
    template = pick_other(other_templates(team_stats, leaders.get('throughWeek') or 0), today)
    if template == 'epa':
        return _epa_chart(team_stats)
    if template == 'race':
        return _race_chart(today)
    return None


def _wp_chart(game: dict, current_season: int):
    from pbp_cache import load_pbp

    pbp = load_pbp(game['season'], current_season)
    if pbp is None:
        return None
    import polars as pl

    plays = (
        pbp.filter(pl.col('game_id') == game['game_id'])
        .select([column for column in PLAY_COLUMNS if column in pbp.columns])
        .to_dicts()
    )
    plays = wp_plays(plays)
    if not plays:
        return None
    points = wp_points(plays, game['away_score'], game['home_score'])
    day = datetime.fromisoformat(game['gameday'])
    meta = {
        'template': 'wp',
        'title': f"Win probability, {game['away_team']} at {game['home_team']}",
        'note': wp_note(game, plays),
        'asOf': f'{day:%a}, {day:%b} {day.day}',
        'source': 'nflverse play-by-play, win probability from the nflfastR model',
    }
    return meta, draw_wp(game, points, key_plays(plays)), 'auto'


def _epa_chart(team_stats: dict):
    meta = {
        'template': 'epa',
        'title': 'Offense and defense, EPA per play',
        'note': epa_note(team_stats),
        'asOf': f"{team_stats['season']} season, through week {team_stats['throughWeek']}",
        'source': 'nflverse play-by-play, EPA from the nflfastR model',
    }
    return meta, draw_epa(team_stats), 'auto'


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
    }
    return meta, draw_race(label, last, series), 'auto'


def write_auto_chart(chart) -> bool:
    """Write src/data/charts/auto.{json,svg}. True when either changed."""
    from common import write_json_if_changed

    if chart is None:
        return False
    meta, fig, slug = chart
    before = (DATA_DIR / 'charts' / 'auto.svg').read_text() if (DATA_DIR / 'charts' / 'auto.svg').exists() else None
    style.save(fig, slug, DATA_DIR / 'charts')
    svg_changed = (DATA_DIR / 'charts' / 'auto.svg').read_text() != before
    return write_json_if_changed('charts/auto.json', meta) or svg_changed
