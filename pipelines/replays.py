"""Build src/data/replays/: one scene per Next Gen Stats highlight play
picked for Retro Replays (plays/<key>.json), and index.json, every play in
the highlights collection with its facts but no tracking, to pick from.

    python pipelines/replays.py 2018_ARI_2018092311_141 [more keys]   scenes
    python pipelines/replays.py --index                                index.json
    python pipelines/replays.py --fetch-all --index                    index.json with stats for every play
    python pipelines/replays.py --all                                  everything the site needs (the deploy)

A key is a file name in asonty/ngs_highlights' play_data/ without .tsv
(season_team_gameId_playId; the team is whose highlight it is, not always
the team that snapped). Files are read at a pinned commit (NGS_SHA) and cached in
pipelines/.cache/ngs/ (gitignored), or NGS_CACHE_DIR if set.

What the source files hold, checked on a pass, rush, sack, punt and kickoff:
10 rows a second (`time` steps by 0.1 s), x and y in yards on the full
120 by 53.3 field, `s` in yards a second, `dir` and `o` in degrees clockwise
from +y. The ball is a row named "ball" with no team, `o` or `dir`. Files
start at the huddle, some frames repeat (46 rows instead of 23), some end
with frames that have only the ball, kickoff players drop in and out, and
players stand past the field's edges.

The rules, in the order they run:
- Rows: the first row for each player (nflId) or the ball in a frame is
  kept, repeats dropped. Frames without a ball row, or with no player's,
  are not frames.
- Featured team: the team the replay follows, the one whose win
  probability rose on the play (featured_team), so its swing is a gain and
  a return or pick-six is seen from the team that made it. With no change
  (or no numbers), the receiving team on a kickoff or punt (KICK_TYPES),
  else the team NGS flags as in possession, which is the team that snaps
  (NGS also flags the kicking team on kicks, and its playDirection is that
  team's). The featured team always moves left to right, on its final
  possession: a play where it goes left is turned round (x to 120 - x,
  y to 53.3 - y, both angles by 180). `field.attack` says which way the
  snapping team then moves (1 right, -1 left: a return or pick-six), for
  its line to gain and air yards.
- Carrier: none before the snap or kick, none while the ball is in the air
  (a flight, below), loose (a fumble, a muff or a kick that lands, until an
  event says who has it) or dead after an incompletion. From the snap the
  snapping team's quarterback (the punter on a punt) holds it until a
  handoff, pass, lateral or fumble. When a flight or a loose ball ends, the
  first player of the team that gets it (a catch or touchdown: the passing
  team; an interception or a return: the other) within CARRIER_REACH yards
  takes it at once; after a handoff, the first new player near it. Then
  whoever has it keeps it until an event takes it away: nearness alone
  never moves it, so tacklers piling on do not. With nobody and no event
  (rare), the nearest player within reach for SWITCH_FRAMES frames takes
  it. From the end of the play (its terminal event) the carrier stays.
- Tracking glitches: after the play, a player who moves faster than
  TOP_SPEED in one frame (tracks reset as players leave) is hidden from
  then on.
- Flights, for the renderer's ball arc: from a pass or kick event to the
  first event that ends it (FLIGHTS), and from a lateral to the first frame
  the ball is within CATCH_REACH of someone other than the tosser (NGS has
  no event for a lateral's catch).
- Start: LEAD_FRAMES before the snap (or the kick on a kickoff). A direct
  snap is a snap; nobody is pinned to it, and the ball's flight from the
  center goes to whoever catches it, as a lateral's does.
- End: TAIL_FRAMES after the first terminal event (TERMINAL_EVENTS). With
  none, STOP_TAIL frames after the carrier's speed first drops under
  STOP_SPEED following first contact. Failing both, the last frame.
- Play facts come from nflverse play-by-play through pbp_cache, matched on
  old_game_id and play_id: description, date, teams, score after the play
  and win probability before and after it, turned to the featured team's
  side, and any penalty.
  The score before the snap, down, distance and clock are NGS's. A play
  where the two disagree on down or distance is printed. A kick has no
  line to gain.

Numbers are stored small: x and y as tenths (integers, `scale` 10), angles
as whole degrees, null where a player has no row in a frame. Speed is not
stored: the renderer works it out from positions. The
format is in src/data/replays/README.md.
"""

import argparse
import csv
import io
import json
import math
import os
import re
import ssl
import sys
import urllib.request
from pathlib import Path

from common import DATA_DIR, normalize_team, stats_season, today_eastern, write_json_if_changed

NGS_SHA = '190df5caa12ec799b2c7579e16f62bdf1d203082'
NGS_RAW = f'https://raw.githubusercontent.com/asonty/ngs_highlights/{NGS_SHA}/play_data'
CACHE_DIR = Path(os.environ.get('NGS_CACHE_DIR') or Path(__file__).resolve().parent / '.cache' / 'ngs')
OUT_DIR = 'replays'
FORMAT_VERSION = 2

HZ = 10
SCALE = 10
FIELD_LENGTH = 120.0
FIELD_WIDTH = 53.3
END_LINE = 110.0  # the goal line the featured team drives toward, left to right

LEAD_FRAMES = 15
TAIL_FRAMES = 15
STOP_SPEED = 1.0
STOP_TAIL = 10
SWITCH_FRAMES = 3
CARRIER_REACH = 2.0
CATCH_REACH = 1.0  # a lateral is caught once the ball is this close to a new player
LATERAL_WINDOW = 30  # frames; a lateral nobody catches within 3 s is a loose ball, not a flight

KICK_TYPES = {'kickoff', 'punt'}
START_EVENTS = ('ball_snap', 'snap_direct', 'kickoff', 'onside_kick')
SNAP_EVENTS = {'ball_snap', 'snap_direct'}
# Tosses NGS marks without a catch: a lateral, and a direct snap (to someone
# other than the quarterback, wildcat style), each a flight to whoever gets it.
TOSSES = {'lateral': 'lateral', 'snap_direct': 'snap'}
TERMINAL_EVENTS = {
    'touchdown', 'tackle', 'out_of_bounds', 'qb_sack', 'qb_strip_sack', 'qb_slide', 'qb_kneel', 'qb_spike',
    'pass_outcome_incomplete', 'pass_outcome_touchdown', 'fair_catch', 'touchback', 'punt_downed', 'safety',
    'field_goal', 'field_goal_missed', 'field_goal_blocked', 'extra_point', 'extra_point_missed',
}
# A flight starts at one of these events and ends at the first of its ends.
FLIGHTS = {
    'pass_forward': ('pass', ('pass_arrived', 'pass_outcome_caught', 'pass_outcome_incomplete',
                              'pass_outcome_interception', 'pass_outcome_touchdown')),
    'pass_shovel': ('pass', ('pass_arrived', 'pass_outcome_caught', 'pass_outcome_incomplete',
                             'pass_outcome_interception', 'pass_outcome_touchdown')),
    'kickoff': ('kick', ('kick_received', 'kickoff_land', 'touchback', 'onside_kick', 'out_of_bounds')),
    'punt': ('punt', ('punt_received', 'fair_catch', 'punt_land', 'punt_downed', 'punt_muffed',
                      'touchback', 'out_of_bounds', 'punt_blocked')),
}
HOLDER_RELEASES = {'handoff', 'pass_forward', 'pass_shovel', 'lateral', 'fumble', 'fumble_offense_recovered',
                   'fumble_defense_recovered', 'punt', 'punt_blocked'}
DEAD_BALL = {'pass_outcome_incomplete', 'touchback', 'punt_downed'}
# A loose ball: from one of these to the first LOOSE_ENDS event after it,
# nobody has it. The end says whose it becomes: the team that snapped,
# the other team, or None (whoever).
LOOSE_STARTS = {'fumble', 'punt_land', 'kickoff_land', 'punt_muffed'}
LOOSE_ENDS = {'fumble_offense_recovered': 'snapping', 'fumble_defense_recovered': 'other',
              'punt_received': 'other', 'kick_received': 'other', 'punt_downed': None, 'touchback': None}
# Whose a flight's ball is when it ends, by the first outcome after it.
CATCHES = {'pass_outcome_caught': 'snapping', 'pass_outcome_touchdown': 'snapping',
           'pass_outcome_interception': 'other', 'kick_received': 'other', 'punt_received': 'other'}
CATCH_LOOKAHEAD = 10  # frames after a flight's end to look for its outcome
TOP_SPEED = 12.5  # yards a second (25.6 mph): faster than anyone runs, so a tracking glitch

# Retired abbreviations and today's franchise: for colors, and to match NGS
# teams to nflverse's. nflverse calls the Rams LA, normalized as everywhere
# else on the site.
COLOR_TEAM = {'OAK': 'LV', 'SD': 'LAC', 'STL': 'LAR'}


# Reading -------------------------------------------------------------------

def fetch(name: str) -> Path:
    """A play_data file from the pinned commit, downloaded once."""
    path = CACHE_DIR / name
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        # Some macOS Python installs ship without root certificates; use
        # certifi's bundle when it is available (as build_teams.py does).
        context = None
        try:
            import certifi

            context = ssl.create_default_context(cafile=certifi.where())
        except ImportError:
            pass
        with urllib.request.urlopen(f'{NGS_RAW}/{name}', timeout=60, context=context) as response:
            body = response.read()
        partial = path.with_suffix(path.suffix + '.partial')
        partial.write_bytes(body)
        partial.replace(path)
    return path


def read_rows(text: str) -> list[dict]:
    return list(csv.DictReader(io.StringIO(text), delimiter='\t'))


def num(value: str) -> float | None:
    return float(value) if value not in ('', 'NA', None) else None


# Normalizing ---------------------------------------------------------------

def flip_xy(x: float, y: float) -> tuple[float, float]:
    return FIELD_LENGTH - x, FIELD_WIDTH - y


def flip_angle(angle: float) -> float:
    return (angle + 180.0) % 360.0


def tenths(value: float | None) -> int | None:
    return None if value is None else int(round(value * SCALE))


def degrees(value: float | None) -> int | None:
    return None if value is None else int(round(value)) % 360


def known(value) -> bool:
    return value is not None and not (isinstance(value, float) and math.isnan(value))


def team_wp(home_wp: float | None, team: str, home: str) -> float | None:
    """nflverse's home win probability from one team's side."""
    if not known(home_wp):
        return None
    wp = home_wp if team == home else 1.0 - home_wp
    return round(wp, 3)


def featured_team(home: str, away: str, home_wp, home_wp_post, fallback: str) -> str:
    """The team a scene follows: the one whose win probability rose on the
    play (so its swing always reads as a gain, and a pick-six or a return
    is seen from the team that made it). When it did not move, or nflverse
    has no numbers, `fallback`: the receiving team on a kick, else the team
    that snapped."""
    if known(home_wp) and known(home_wp_post) and home_wp_post != home_wp:
        return home if home_wp_post > home_wp else away
    return fallback


# Frames --------------------------------------------------------------------

def frames_of(rows: list[dict]) -> tuple[dict, dict, list[int]]:
    """Players' and the ball's rows by frame, repeats dropped, and the
    frames that have a ball row and at least one player's, in order (some
    files end with frames of the ball alone)."""
    players: dict[str, dict[int, dict]] = {}
    ball: dict[int, dict] = {}
    for row in rows:
        frame = int(row['frame'])
        if row['displayName'] == 'ball':
            ball.setdefault(frame, row)
        elif row['nflId']:
            players.setdefault(row['nflId'], {}).setdefault(frame, row)
    tracked = {f for track in players.values() for f in track}
    return players, ball, sorted(f for f in ball if f in tracked)


def events_of(rows: list[dict]) -> list[tuple[int, str]]:
    """(frame, event) once each, in frame order."""
    seen = sorted({(int(r['frame']), r['event']) for r in rows if r['event']})
    return seen


def first_event(events, names, after: int = -1) -> tuple[int, str] | None:
    for frame, name in events:
        if frame >= after and name in names:
            return frame, name
    return None


def flights_of(events) -> list[dict]:
    flights = []
    for frame, name in events:
        if name not in FLIGHTS:
            continue
        kind, ends = FLIGHTS[name]
        end = first_event(events, ends, after=frame + 1)
        if end and not (flights and flights[-1]['to'] > frame):
            flights.append({'kind': kind, 'from': frame, 'to': end[0]})
    return flights


def lateral_flights(events, players, ball, frames: list[int]) -> list[dict]:
    """A lateral's or direct snap's flight (TOSSES). NGS marks the toss but
    not the catch, so it runs from the toss to the first frame the ball is
    within CATCH_REACH of a player other than the one who tossed it (the
    player nearest the ball two frames before: on a direct snap, the
    center)."""
    flights = []
    order = {f: i for i, f in enumerate(frames)}
    for frame, name in events:
        if name not in TOSSES or frame not in order:
            continue
        i = order[frame]
        before = frames[max(0, i - 2)]
        tosser = nearest(players, ball[before], before)
        for f in frames[i + 1:i + 1 + LATERAL_WINDOW]:
            catcher = nearest(players, ball[f], f, CATCH_REACH)
            if catcher is not None and catcher != tosser:
                flights.append({'kind': TOSSES[name], 'from': frame, 'to': f})
                break
    return flights


def all_flights(events, players, ball, frames: list[int]) -> list[dict]:
    """Passes and kicks from their events, laterals and direct snaps from where the ball goes."""
    return sorted(flights_of(events) + lateral_flights(events, players, ball, frames), key=lambda fl: fl['from'])


def start_frame(events, frames: list[int]) -> int:
    start = first_event(events, START_EVENTS)
    if start is None:
        return frames[0]
    return max(frames[0], start[0] - LEAD_FRAMES)


def speed_at(track: dict[int, dict], frame: int) -> float | None:
    row = track.get(frame)
    return num(row['s']) if row else None


def end_frame(events, frames: list[int], snap: int, carriers: dict[int, str | None], players) -> int:
    last = frames[-1]
    terminal = first_event(events, TERMINAL_EVENTS, after=snap)
    if terminal:
        return min(last, terminal[0] + TAIL_FRAMES)
    contact = first_event(events, {'first_contact'}, after=snap)
    if contact:
        for frame in frames:
            if frame < contact[0]:
                continue
            carrier = carriers.get(frame)
            speed = speed_at(players[carrier], frame) if carrier else None
            if speed is not None and speed < STOP_SPEED:
                return min(last, frame + STOP_TAIL)
    return last


# Carrier -------------------------------------------------------------------

def nearest(players, ball_row: dict, frame: int, reach: float = CARRIER_REACH, team: str | None = None) -> str | None:
    """The player nearest the ball within `reach`, of `team` only when given."""
    bx, by = float(ball_row['x']), float(ball_row['y'])
    best, best_d = None, reach
    for pid, track in players.items():
        row = track.get(frame)
        if row is None or (team is not None and row['teamAbbr'] != team):
            continue
        d = math.hypot(float(row['x']) - bx, float(row['y']) - by)
        if d <= best_d:
            best, best_d = pid, d
    return best


def holder_at_snap(players, ball_row: dict, frame: int, snapping: str, position: str) -> str | None:
    """The snapping team's player at `position` nearest the ball at the snap."""
    bx, by = float(ball_row['x']), float(ball_row['y'])
    options = []
    for pid, track in players.items():
        row = track.get(frame)
        if row and row['teamAbbr'] == snapping and row['position'] == position:
            options.append((math.hypot(float(row['x']) - bx, float(row['y']) - by), pid))
    return min(options)[1] if options else None


def action_end(events, snap: int) -> int | None:
    """The frame the play is over: its first terminal event after the snap."""
    terminal = first_event(events, TERMINAL_EVENTS, after=snap)
    return terminal[0] if terminal else None


def loose_frames(events, frames: list[int]) -> set[int]:
    """Frames the ball is loose: from a fumble, a muff or a kick landing to
    the first event saying who has it (LOOSE_ENDS), or the last frame."""
    loose: set[int] = set()
    for frame, name in events:
        if name not in LOOSE_STARTS:
            continue
        end = first_event(events, set(LOOSE_ENDS), after=frame + 1)
        loose.update(f for f in frames if frame <= f < (end[0] if end else frames[-1] + 1))
    return loose


def carriers_of(players, ball, frames: list[int], events, snapping: str, play_type: str) -> dict[int, str | None]:
    """The ball carrier's nflId (or None) for every frame, by the rules in
    the module docstring: nobody before the snap, in the air, loose or dead;
    the quarterback (or punter) from the snap to his release; at the end of
    a flight or a loose ball, the first player of the team that gets it
    (CATCHES, LOOSE_ENDS) to be within reach, at once; after a handoff, the
    first new player; otherwise whoever has it keeps it, and with nobody,
    the nearest player within reach for SWITCH_FRAMES frames takes it. From
    the end of the play the carrier stays as it was."""
    snap = first_event(events, START_EVENTS)
    if snap is None:
        return {frame: None for frame in frames}
    team_of = {pid: track[min(track)]['teamAbbr'] for pid, track in players.items()}
    other = next((t for t in team_of.values() if t and t != snapping), None)
    side = {'snapping': snapping, 'other': other, None: None}
    flights = all_flights(events, players, ball, frames)
    in_flight = lambda f: any(fl['from'] <= f < fl['to'] for fl in flights)
    landings = {f for f, name in events if name in ('punt_land', 'kickoff_land')}
    handoffs = {f for f, name in events if name == 'handoff' and f >= snap[0]}
    loose = loose_frames(events, frames)
    loose_end = {f: LOOSE_ENDS[name] for f, name in events if name in LOOSE_ENDS}
    dead = first_event(events, DEAD_BALL, after=snap[0])
    over = action_end(events, snap[0])

    def catcher_team(flight, last_team):
        """Whose a flight's ball is at its end: by its outcome; a lateral or
        direct snap stays with the team that tossed it."""
        if flight['kind'] in ('lateral', 'snap'):
            return last_team or snapping
        outcome = next((name for f, name in events
                        if flight['to'] <= f <= flight['to'] + CATCH_LOOKAHEAD and name in CATCHES), None)
        return side[CATCHES[outcome]] if outcome else None

    holder, release = None, None
    if snap[1] == 'ball_snap':
        position = 'P' if play_type == 'punt' else 'QB'
        holder = holder_at_snap(players, ball[snap[0]], snap[0], snapping, position)
        released = first_event(events, HOLDER_RELEASES, after=snap[0])
        release = released[0] if released else None

    carriers: dict[int, str | None] = {}
    current, candidate, streak = None, None, 0
    taking = False  # a flight or loose ball has ended: the first of `taking_team` in reach takes it at once
    taking_team: str | None = None
    handing = False
    last_team: str | None = None
    for frame in frames:
        if over is not None and frame > over:
            carriers[frame] = carriers.get(over)
            continue
        if frame in handoffs:
            handing = True
        if frame < snap[0] or (dead and frame >= dead[0]):
            current = None
        elif in_flight(frame):
            if current is not None:
                last_team = team_of[current]
            current, taking = None, True
            flight = next(fl for fl in flights if fl['from'] <= frame < fl['to'])
            taking_team = None if flight['to'] in landings else catcher_team(flight, last_team)
            if flight['to'] in landings:
                taking = False  # a kick that lands is loose, not caught
        elif holder and (release is None or frame < release) and frame not in loose:
            current = holder
        elif frame in loose:
            if current is not None:
                last_team = team_of[current]
            current, taking = None, False
        else:
            if frame in loose_end:
                taking, taking_team = True, side[loose_end[frame]]
            if taking:
                near = nearest(players, ball[frame], frame, CARRIER_REACH, taking_team)
                if near is not None:
                    current, taking, handing = near, False, False
            elif handing:
                near = nearest(players, ball[frame], frame)
                if near is not None and near != current:
                    current, handing = near, False
            elif current is None:
                near = nearest(players, ball[frame], frame)
                streak = streak + 1 if near is not None and near == candidate else (1 if near else 0)
                candidate = near
                if streak >= SWITCH_FRAMES:
                    current, candidate, streak = near, None, 0
        if current is not None:
            last_team = team_of[current]
        carriers[frame] = current
    return carriers


# Building ------------------------------------------------------------------

def team_colors(teams: list[dict]) -> dict[str, dict]:
    return {t['abbr']: {'primary': t['primary'], 'secondary': t['secondary']} for t in teams}


def team_entry(abbr: str, colors: dict[str, dict]) -> dict:
    shown = normalize_team(abbr)
    palette = colors.get(COLOR_TEAM.get(shown, shown), {'primary': '#5b6570', 'secondary': '#ffffff'})
    return {'abbr': shown, **palette}


def glitch_after(track: dict[int, dict], frames: list[int], over: int | None) -> int | None:
    """The first frame after the play that a player moves faster than
    TOP_SPEED from the frame before: a track resetting as he leaves."""
    if over is None:
        return None
    for prev, f in zip(frames, frames[1:]):
        a, b = track.get(prev), track.get(f)
        if f <= over or a is None or b is None:
            continue
        step = math.hypot(float(b['x']) - float(a['x']), float(b['y']) - float(a['y']))
        if step * HZ / (f - prev) > TOP_SPEED:
            return f
    return None


def yardline_text(value: str) -> str | None:
    """NGS's yard line as people write it: 'BAL 03' is 'BAL 3'."""
    return re.sub(r' 0(\d)$', r' \1', value) or None


def build_scene(key: str, rows: list[dict], pbp_row: dict | None, colors: dict[str, dict]) -> dict:
    first = rows[0]
    players, ball, frames = frames_of(rows)
    events = events_of(rows)
    play_type = first['playType'].removeprefix('play_type_')
    kick = play_type in KICK_TYPES
    snapping = next(r['teamAbbr'] for r in rows if num(r['possessionFlag']) == 1)
    other = next(r['teamAbbr'] for r in rows if r['teamAbbr'] and r['teamAbbr'] != snapping)
    home = next(r['teamAbbr'] for r in rows if num(r['homeTeamFlag']) == 1)
    away = other if home == snapping else snapping
    featured = featured_team(home, away, (pbp_row or {}).get('home_wp'), (pbp_row or {}).get('home_wp_post'),
                             other if kick else snapping)
    opponent = other if featured == snapping else snapping
    # playDirection is the snapping team's. The featured team moves left to
    # right; when it is not the team that snapped (a return, a pick-six) the
    # snapping team moves right to left (`attack` -1).
    attack = 1 if featured == snapping else -1
    flip = (first['playDirection'] == 'left') != (attack == -1)

    carriers = carriers_of(players, ball, frames, events, snapping, play_type)
    snap = first_event(events, START_EVENTS)
    start = start_frame(events, frames)
    end = end_frame(events, frames, snap[0] if snap else frames[0], carriers, players)
    kept = [f for f in frames if start <= f <= end]
    index = {f: i for i, f in enumerate(kept)}

    def point(row):
        x, y = float(row['x']), float(row['y'])
        return flip_xy(x, y) if flip else (x, y)

    def angle(value):
        a = num(value)
        return None if a is None else (flip_angle(a) if flip else a)

    ball_x, ball_y = [], []
    for f in kept:
        x, y = point(ball[f])
        ball_x.append(tenths(x))
        ball_y.append(tenths(y))

    over = action_end(events, snap[0]) if snap else None
    order = sorted(players, key=lambda pid: (players[pid][min(players[pid])]['teamAbbr'] != featured, pid))
    scene_players = []
    for pid in order:
        track = players[pid]
        any_row = track[min(track)]
        xs, ys, dirs, os_ = [], [], [], []
        gone = glitch_after(track, kept, over)
        for f in kept:
            row = track.get(f) if gone is None or f < gone else None
            if row is None:
                for column in (xs, ys, dirs, os_):
                    column.append(None)
                continue
            x, y = point(row)
            xs.append(tenths(x))
            ys.append(tenths(y))
            dirs.append(degrees(angle(row['dir'])))
            os_.append(degrees(angle(row['o'])))
        if all(x is None for x in xs):
            continue
        jersey = num(any_row['jerseyNumber'])
        scene_players.append({
            'id': pid,
            'side': 'featured' if any_row['teamAbbr'] == featured else 'opponent',
            'jersey': None if jersey is None else int(jersey),
            'position': any_row['position'] or None,
            'name': any_row['displayName'],
            'x': xs, 'y': ys, 'dir': dirs, 'o': os_,
        })
    slot = {p['id']: i for i, p in enumerate(scene_players)}

    raw_los = num(first['absoluteYardlineNumber'])
    los = None if raw_los is None else (FIELD_LENGTH - raw_los if flip else raw_los)
    down = int(num(first['down']) or 0) or None
    to_go = num(first['yardsToGo'])
    # The line to gain is the snapping team's, the way it is going.
    first_down = None
    if los is not None and down and to_go and not kick:
        first_down = min(END_LINE, los + to_go) if attack == 1 else max(FIELD_LENGTH - END_LINE, los - to_go)

    play = play_facts(first, pbp_row, featured, home)
    return {
        'version': FORMAT_VERSION,
        'key': key,
        'source': 'ngs',
        'hz': HZ,
        'scale': SCALE,
        'frameCount': len(kept),
        'play': {**play, 'type': play_type, 'featured': normalize_team(featured), 'opponent': normalize_team(opponent),
                 'possession': normalize_team(snapping), 'home': normalize_team(home), 'away': normalize_team(away),
                 'kicking': normalize_team(snapping) if kick else None},
        'field': {'lineOfScrimmage': los, 'firstDown': first_down, 'attack': attack},
        'teams': {'featured': team_entry(featured, colors), 'opponent': team_entry(opponent, colors)},
        'events': [{'frame': index[f], 'name': name} for f, name in events if f in index],
        'flights': [{**fl, 'from': index[fl['from']], 'to': index[fl['to']]}
                    for fl in all_flights(events, players, ball, frames) if fl['from'] in index and fl['to'] in index],
        'ball': {'x': ball_x, 'y': ball_y},
        'carrier': [slot.get(carriers.get(f)) for f in kept],
        'players': scene_players,
    }


MPH_PER_YARD_PER_SECOND = 3600 / 1760


def play_stats(rows: list[dict]) -> dict:
    """Numbers from a play's tracking for the catalog, by the scenes'
    rules: how many snaps the file has, the carrier's top speed (mph, NGS's
    `s`, over the frames a scene keeps) and the first forward pass's air
    yards (where the ball arrived, past the line of scrimmage); null when
    the play has no carrier or no pass. 21 files repeat the play (two snaps,
    the second copy's events offset, some of them mislabelled); no rule
    picks the right copy for all of them, so they get no numbers."""
    first = rows[0]
    players, ball, frames = frames_of(rows)
    events = events_of(rows)
    snaps = sum(1 for _, name in events if name in SNAP_EVENTS)
    if snaps > 1:
        return {'snaps': snaps, 'topSpeed': None, 'airYards': None}
    play_type = first['playType'].removeprefix('play_type_')
    snapping = next(r['teamAbbr'] for r in rows if num(r['possessionFlag']) == 1)
    carriers = carriers_of(players, ball, frames, events, snapping, play_type)
    snap = first_event(events, START_EVENTS)
    start = start_frame(events, frames)
    end = end_frame(events, frames, snap[0] if snap else frames[0], carriers, players)
    speeds = [speed_at(players[c], f) for f in frames if start <= f <= end and (c := carriers.get(f))]
    speeds = [v for v in speeds if v is not None]
    air = None
    pass_flight = next((fl for fl in flights_of(events) if fl['kind'] == 'pass'), None)
    los = num(first['absoluteYardlineNumber'])
    if pass_flight and los is not None and pass_flight['to'] in ball:
        # Passes are the snapping team's, which goes the way playDirection says.
        sign = 1 if first['playDirection'] == 'right' else -1
        air = round(sign * (float(ball[pass_flight['to']]['x']) - los))
    return {
        'snaps': snaps,
        'topSpeed': round(max(speeds) * MPH_PER_YARD_PER_SECOND, 1) if speeds else None,
        'airYards': air,
    }


def penalty_of(pbp_row: dict) -> dict | None:
    """A penalty on the play, from nflverse: its team, player, type and
    yards (as enforced, so half the distance shows as such)."""
    if not known(pbp_row.get('penalty')) or not pbp_row['penalty']:
        return None
    yards = pbp_row.get('penalty_yards')
    return {
        'team': normalize_team(pbp_row['penalty_team']) if pbp_row.get('penalty_team') else None,
        'player': pbp_row.get('penalty_player_name'),
        'type': pbp_row.get('penalty_type'),
        'yards': int(yards) if known(yards) else None,
    }


def play_facts(first: dict, pbp_row: dict | None, featured: str, home: str) -> dict:
    """What the scoreboard shows: NGS's situation before the snap, nflverse's
    description, date, score after, win probability (the featured team's)
    and any penalty."""
    down = int(num(first['down']) or 0) or None
    before = {'home': int(num(first['preSnapHomeScore']) or 0), 'away': int(num(first['preSnapVisitorScore']) or 0)}
    facts = {
        'season': int(first['season']),
        'seasonType': first['seasonType'],
        'week': int(first['week']),
        'gameId': first['gameId'],
        'playId': int(first['playId']),
        'quarter': int(first['quarter']),
        'clock': first['gameClock'],
        'down': down,
        'yardsToGo': int(num(first['yardsToGo'])) if down else None,
        'yardline': yardline_text(first['yardline']),
        'scoreBefore': before,
        'description': first['playDescription'],
        'date': None, 'nflverseGameId': None, 'scoreAfter': None, 'wpBefore': None, 'wpAfter': None,
        'penalty': None,
    }
    if pbp_row is None:
        return facts
    # nflverse names some moved teams by today's abbreviation (the 2018
    # Raiders are LV there, OAK in NGS): compare franchises.
    nflverse_home = normalize_team(pbp_row['home_team'])
    franchise = lambda abbr: COLOR_TEAM.get(normalize_team(abbr), normalize_team(abbr))
    if franchise(nflverse_home) != franchise(home):
        raise ValueError(f'{first["gameId"]} {first["playId"]}: home team {home} in NGS, {nflverse_home} in nflverse')
    facts.update({
        'date': pbp_row['game_date'],
        'nflverseGameId': pbp_row['game_id'],
        'description': pbp_row['desc'],
        'scoreAfter': {'home': int(pbp_row['total_home_score']), 'away': int(pbp_row['total_away_score'])},
        'wpBefore': team_wp(pbp_row['home_wp'], featured, home),
        'wpAfter': team_wp(pbp_row['home_wp_post'], featured, home),
        'penalty': penalty_of(pbp_row),
    })
    return facts


def situation_mismatch(first: dict, pbp_row: dict) -> str | None:
    down = int(num(first['down']) or 0) or None
    to_go = int(num(first['yardsToGo']) or 0) if down else None
    p_down = int(pbp_row['down']) if pbp_row['down'] is not None else None
    p_to_go = int(pbp_row['ydstogo']) if p_down else None
    if (down, to_go) != (p_down, p_to_go):
        return f'NGS {down} and {to_go}, nflverse {p_down} and {p_to_go}'
    return None


def index_entry(row: dict, pbp_row: dict | None, stats: dict | None = None) -> dict:
    """One highlight's line in index.json, from the highlights index and
    nflverse play-by-play: who, when, the situation, the description and
    the win probability of the team the scene would follow (featured_team;
    with no change, the receiving team on a kick: nflverse's posteam on a
    kickoff, its defteam on a punt)."""
    key = f'{row["season"]}_{row["teamAbbr"]}_{row["gameId"]}_{row["playId"]}'
    play_type = row['play.playType'].removeprefix('play_type_')
    down = int(num(row['play.down']) or 0) or None
    to_go = num(row['play.yardsToGo'])
    entry = {
        'key': key,
        'date': None,
        'season': int(row['season']),
        'seasonType': row['seasonType'],
        'week': int(row['week']),
        'gameId': row['gameId'],
        'playId': int(row['playId']),
        'away': None,
        'home': None,
        'featured': None,
        'opponent': None,
        'type': play_type,
        'quarter': int(num(row['play.quarter']) or 0) or None,
        'clock': row['play.gameClock'] or None,
        'down': down,
        'yardsToGo': int(to_go) if down and to_go is not None else None,
        'description': row['play.playDescription'],
        'touchdown': 'TOUCHDOWN' in row['play.playDescription'].upper(),
        'wpBefore': None,
        'wpAfter': None,
        # From the play's tracking file when it is cached (play_stats), else null.
        'snaps': (stats or {}).get('snaps'),
        'topSpeed': (stats or {}).get('topSpeed'),
        'airYards': (stats or {}).get('airYards'),
    }
    if pbp_row is None:
        return entry
    home, away = normalize_team(pbp_row['home_team']), normalize_team(pbp_row['away_team'])
    posteam = normalize_team(pbp_row['posteam'] or '')
    defteam = normalize_team(pbp_row['defteam'] or '')
    fallback = defteam if play_type == 'punt' else posteam
    featured = featured_team(home, away, pbp_row['home_wp'], pbp_row['home_wp_post'], fallback) or None
    opponent = (away if featured == home else home) if featured else None
    entry.update({
        'date': pbp_row['game_date'],
        'away': away,
        'home': home,
        'featured': featured,
        'opponent': opponent,
        'description': pbp_row['desc'],
        'touchdown': bool(pbp_row['touchdown']),
        'wpBefore': team_wp(pbp_row['home_wp'], featured, home) if featured else None,
        'wpAfter': team_wp(pbp_row['home_wp_post'], featured, home) if featured else None,
    })
    return entry


def index_entries(rows: list[dict], lookup, stats=lambda key: None) -> list[dict]:
    """Every highlight once, oldest first. The highlights index lists a few
    plays twice (the same play as two teams' highlight, or the same row
    repeated); the first key in key order stands for the play."""
    seen: set[tuple[str, str]] = set()
    entries = []
    for row in sorted(rows, key=lambda r: f'{r["season"]}_{r["teamAbbr"]}_{r["gameId"]}_{r["playId"]}'):
        play = (row['gameId'], row['playId'])
        if play in seen:
            continue
        seen.add(play)
        key = f'{row["season"]}_{row["teamAbbr"]}_{row["gameId"]}_{row["playId"]}'
        entries.append(index_entry(row, lookup(int(row['season']), row['gameId'], int(row['playId'])), stats(key)))
    entries.sort(key=lambda e: (e['date'] or '', e['gameId'], e['playId']))
    return entries


# Writing -------------------------------------------------------------------

def write_scene(scene: dict) -> Path:
    path = DATA_DIR / OUT_DIR / 'plays' / f'{scene["key"]}.json'
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(scene, separators=(',', ':'), ensure_ascii=False) + '\n', encoding='utf-8')
    return path


def write_index(entries: list[dict]) -> None:
    write_json_if_changed(f'{OUT_DIR}/index.json', {'version': FORMAT_VERSION, 'plays': entries}, records=True)


# Checks --------------------------------------------------------------------

CARRIER_GAP = 1.5  # seconds with nobody holding a live ball, outside flights and loose balls
OFF_FIELD = 5.0  # yards outside the field
CHECKS = {
    'repeats': 'tracking repeats the play',
    'no-pbp': 'no play-by-play match',
    'carrier-gap': f'nobody holds the ball for over {CARRIER_GAP:g} s',
    'off-field': f'the ball goes over {OFF_FIELD:g} yards off the field',
    'speed': f'a player moves faster than {TOP_SPEED * MPH_PER_YARD_PER_SECOND:.1f} mph in one frame',
}


def check_scene(scene: dict, snaps: int | None, joined: bool) -> list[str]:
    """Why a scene should not ship (CHECKS keys), empty when it passes. The
    play's action runs from the snap (or kick) to its terminal event. In it:
    nobody holds the ball for over CARRIER_GAP while it is live (in the air,
    loose after a fumble, muff or landed kick until an event says who has it,
    or dead after an incompletion do not count); the ball goes OFF_FIELD
    yards outside the field; a player moves faster than TOP_SPEED between
    frames. Also a file that repeats the play, and a play nflverse lacks."""
    reasons = []
    if (snaps or 0) > 1:
        reasons.append('repeats')
    if not joined:
        reasons.append('no-pbp')
    n, hz = scene['frameCount'], scene['hz']
    events = [(e['frame'], e['name']) for e in scene['events']]
    frames = list(range(n))
    snap = first_event(events, START_EVENTS)
    start = snap[0] if snap else 0
    over = action_end(events, start)
    end = n - 1 if over is None else over
    flights = scene['flights']
    loose = loose_frames(events, frames)
    dead = first_event(events, DEAD_BALL, after=start)
    carrier = scene.get('carrier') or [None] * n
    run = gap = 0
    for f in range(start, end + 1):
        exempt = any(fl['from'] <= f < fl['to'] for fl in flights) or f in loose or (dead and f >= dead[0])
        run = run + 1 if carrier[f] is None and not exempt else 0
        gap = max(gap, run)
    if gap / hz > CARRIER_GAP:
        reasons.append('carrier-gap')
    scale = scene['scale']
    bx, by = scene['ball']['x'], scene['ball']['y']
    if any(max(-bx[f], bx[f] - FIELD_LENGTH * scale, -by[f], by[f] - FIELD_WIDTH * scale) > OFF_FIELD * scale
           for f in range(start, end + 1)):
        reasons.append('off-field')
    for p in scene.get('players') or []:
        xs, ys = p['x'], p['y']
        if any(xs[f - 1] is not None and xs[f] is not None
               and math.hypot(xs[f] - xs[f - 1], ys[f] - ys[f - 1]) / scale * hz > TOP_SPEED
               for f in range(max(1, start), end + 1)):
            reasons.append('speed')
            break
    return reasons


def featured_keys() -> list[str]:
    path = DATA_DIR / OUT_DIR / 'featured.json'
    return json.loads(path.read_text(encoding='utf-8'))['keys'] if path.exists() else []


def build_all(lookup, colors) -> dict:
    """Every play in the highlights index once: index.json, a scene for each
    that passes check_scene, and validation.json with the counts and every
    excluded play's reasons. Scene files of plays no longer kept are removed.
    Featured plays that fail are reported, not shipped."""
    rows = read_rows(fetch('ngs_highlights_index.tsv').read_text(encoding='utf-8'))
    tracking: dict[str, list[dict]] = {}

    def stats(key: str) -> dict | None:
        tracking[key] = read_rows(fetch(f'{key}.tsv').read_text(encoding='utf-8'))
        return play_stats(tracking[key])

    entries = index_entries(rows, lookup, stats)
    write_index(entries)
    plays_dir = DATA_DIR / OUT_DIR / 'plays'
    kept: set[str] = set()
    excluded: dict[str, list[str]] = {}
    for entry in entries:
        key = entry['key']
        play_rows = tracking[key]
        first = play_rows[0]
        pbp_row = lookup(int(first['season']), first['gameId'], int(first['playId']))
        if (entry['snaps'] or 0) > 1:
            excluded[key] = check_scene({'frameCount': 0, 'hz': HZ, 'scale': SCALE, 'events': [], 'flights': [],
                                         'ball': {'x': [], 'y': []}}, entry['snaps'], pbp_row is not None)
            continue
        scene = build_scene(key, play_rows, pbp_row, colors)
        reasons = check_scene(scene, entry['snaps'], pbp_row is not None)
        if reasons:
            excluded[key] = reasons
        else:
            write_scene(scene)
            kept.add(key)
    if plays_dir.exists():
        for path in plays_dir.glob('*.json'):
            if path.stem not in kept:
                path.unlink()
    counts = {code: sum(1 for r in excluded.values() if code in r) for code in CHECKS}
    featured = featured_keys()
    report = {
        'version': FORMAT_VERSION,
        'ngsSha': NGS_SHA,
        'kept': len(kept),
        'excluded': len(excluded),
        'reasons': {code: {'words': CHECKS[code], 'plays': counts[code]} for code in CHECKS},
        'excludedPlays': dict(sorted(excluded.items())),
        'featuredDropped': {k: excluded.get(k, ['not in the highlights index']) for k in featured if k not in kept},
    }
    write_json_if_changed(f'{OUT_DIR}/validation.json', report)
    return report


def report_lines(report: dict) -> list[str]:
    """validation.json in words, for the run's log and the job summary."""
    lines = [f'Retro Replays: {report["kept"]} replays built, {report["excluded"]} plays excluded.', '',
             '| Check | Plays excluded |', '|---|---|']
    lines += [f'| {r["words"]} | {r["plays"]} |' for r in report['reasons'].values()]
    lines.append('')
    if report['featuredDropped']:
        lines.append('**Warning: featured plays dropped from Featured**')
        lines += [f'- `{k}`: {", ".join(CHECKS.get(c, c) for c in reasons)}' for k, reasons in report['featuredDropped'].items()]
    else:
        lines.append('All featured plays passed.')
    return lines


def pbp_lookup(season: int):
    """(old_game_id, play_id) -> play-by-play row for one season."""
    import polars as pl
    from pbp_cache import load_pbp

    pbp = load_pbp(season, stats_season(today_eastern()))
    if pbp is None:
        return {}
    columns = ['old_game_id', 'play_id', 'game_id', 'game_date', 'home_team', 'away_team', 'posteam', 'defteam',
               'desc', 'down', 'ydstogo', 'touchdown', 'total_home_score', 'total_away_score', 'home_wp',
               'home_wp_post', 'penalty', 'penalty_team', 'penalty_player_name', 'penalty_yards', 'penalty_type']
    frame = pbp.select(columns).with_columns(pl.col('play_id').cast(pl.Int64))
    return {(r['old_game_id'], r['play_id']): r for r in frame.iter_rows(named=True)}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    parser.add_argument('keys', nargs='*', help='play keys to build scenes for, e.g. 2018_ARI_2018092311_141')
    parser.add_argument('--index', action='store_true',
                        help='rewrite index.json from the whole highlights index, with stats from every cached play file')
    parser.add_argument('--fetch-all', action='store_true',
                        help='first download every play file not yet cached (about 1.3 GB) so --index has stats for all')
    parser.add_argument('--all', action='store_true',
                        help='index.json, a scene for every play that passes the checks, and validation.json '
                             '(what the deploy runs)')
    args = parser.parse_args()
    if not args.keys and not args.index and not args.fetch_all and not args.all:
        parser.error('give play keys, --index, --fetch-all, --all, or a mix')

    lookups: dict[int, dict] = {}

    def lookup(season: int, game_id: str, play_id: int) -> dict | None:
        if season not in lookups:
            lookups[season] = pbp_lookup(season)
        return lookups[season].get((game_id, play_id))

    colors = team_colors(json.loads((DATA_DIR / 'teams.json').read_text(encoding='utf-8')))
    total = 0
    for key in args.keys:
        rows = read_rows(fetch(f'{key}.tsv').read_text(encoding='utf-8'))
        first = rows[0]
        pbp_row = lookup(int(first['season']), first['gameId'], int(first['playId']))
        if pbp_row is None:
            print(f'{key}: not in nflverse play-by-play, written without its facts', file=sys.stderr)
        elif mismatch := situation_mismatch(first, pbp_row):
            print(f'{key}: situation differs: {mismatch}', file=sys.stderr)
        scene = build_scene(key, rows, pbp_row, colors)
        path = write_scene(scene)
        size = path.stat().st_size
        total += size
        print(f'{key}: {scene["frameCount"]} frames, {len(scene["players"])} players, {size / 1024:.1f} KB')
    if args.keys:
        print(f'{len(args.keys)} scenes written ({total / 1024:.0f} KB)')

    if args.fetch_all:
        from concurrent.futures import ThreadPoolExecutor
        rows = read_rows(fetch('ngs_highlights_index.tsv').read_text(encoding='utf-8'))
        names = sorted({f'{r["season"]}_{r["teamAbbr"]}_{r["gameId"]}_{r["playId"]}.tsv' for r in rows})
        missing = [n for n in names if not (CACHE_DIR / n).exists()]
        print(f'fetching {len(missing)} of {len(names)} play files')
        with ThreadPoolExecutor(max_workers=8) as pool:
            for done, _ in enumerate(pool.map(fetch, missing), 1):
                if done % 50 == 0:
                    print(f'  {done} of {len(missing)}')

    if args.all:
        report = build_all(lookup, colors)
        lines = report_lines(report)
        print('\n'.join(lines))
        if summary := os.environ.get('GITHUB_STEP_SUMMARY'):
            with open(summary, 'a', encoding='utf-8') as fh:
                fh.write('\n'.join(lines) + '\n')
        if report['featuredDropped']:
            for key in report['featuredDropped']:
                print(f'::warning title=Featured replay dropped::{key} failed its checks; see the job summary')

    if args.index and not args.all:
        rows = read_rows(fetch('ngs_highlights_index.tsv').read_text(encoding='utf-8'))

        def stats(key: str) -> dict | None:
            path = CACHE_DIR / f'{key}.tsv'
            return play_stats(read_rows(path.read_text(encoding='utf-8'))) if path.exists() else None

        entries = index_entries(rows, lookup, stats)
        write_index(entries)
        joined = sum(1 for e in entries if e['date'])
        tracked = sum(1 for e in entries if e['topSpeed'] is not None or e['airYards'] is not None)
        print(f'index.json: {len(entries)} plays from {len(rows)} index rows, {joined} joined to play-by-play, '
              f'{tracked} with tracking stats')
        for e in entries:
            if not e['date']:
                print(f'  {e["key"]}: not in nflverse play-by-play', file=sys.stderr)


if __name__ == '__main__':
    main()
