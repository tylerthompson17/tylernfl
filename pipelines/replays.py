"""Build src/data/replays/: one scene per Next Gen Stats highlight play, for
Retro Replays, and an index of every scene built.

    python pipelines/replays.py 2018_ARI_2018092311_141 [more keys]
    python pipelines/replays.py --all

A key is a file name in asonty/ngs_highlights' play_data/ without .tsv
(season_team_gameId_playId; the team is whose highlight it is, not always
the offense). Files are read at a pinned commit (NGS_SHA) and cached in
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
  kept, repeats dropped. Frames without a ball row are not frames.
- Offense: the team whose side the replay takes. On a kickoff or punt
  (KICK_TYPES) it is the receiving team; otherwise the team NGS flags as in
  possession, which is the team that snaps (NGS also flags the kicking team
  on kicks, and its playDirection is that team's). The offense always moves
  left to right: a play where it goes left is turned round (x to 120 - x,
  y to 53.3 - y, both angles by 180).
- Carrier: none before the snap or kick, none while the ball is in the air
  (a flight, below) or dead after an incompletion. From the snap the
  snapping team's quarterback (the punter on a punt) holds it until a
  handoff, pass, lateral or fumble. Otherwise it is the player nearest the ball within
  CARRIER_REACH yards; a new nearest player (or nobody) takes over only
  after SWITCH_FRAMES frames in a row, except that the first carrier after
  a flight is taken at once.
- Flights, for the renderer's ball arc: from a pass or kick event to the
  first event that ends it (FLIGHTS).
- Start: LEAD_FRAMES before the snap (or the kick on a kickoff).
- End: TAIL_FRAMES after the first terminal event (TERMINAL_EVENTS). With
  none, STOP_TAIL frames after the carrier's speed first drops under
  STOP_SPEED following first contact. Failing both, the last frame.
- Play facts come from nflverse play-by-play through pbp_cache, matched on
  old_game_id and play_id: description, date, teams, score after the play
  and win probability before and after it, turned to the offense's side.
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
import ssl
import sys
import urllib.request
from pathlib import Path

from common import DATA_DIR, normalize_team, stats_season, today_eastern, write_json_if_changed

NGS_SHA = '190df5caa12ec799b2c7579e16f62bdf1d203082'
NGS_RAW = f'https://raw.githubusercontent.com/asonty/ngs_highlights/{NGS_SHA}/play_data'
CACHE_DIR = Path(os.environ.get('NGS_CACHE_DIR') or Path(__file__).resolve().parent / '.cache' / 'ngs')
OUT_DIR = 'replays'
FORMAT_VERSION = 1

HZ = 10
SCALE = 10
FIELD_LENGTH = 120.0
FIELD_WIDTH = 53.3
END_LINE = 110.0  # the offense's goal line once it drives left to right

LEAD_FRAMES = 15
TAIL_FRAMES = 15
STOP_SPEED = 1.0
STOP_TAIL = 10
SWITCH_FRAMES = 3
CARRIER_REACH = 2.0

KICK_TYPES = {'kickoff', 'punt'}
START_EVENTS = ('ball_snap', 'kickoff', 'onside_kick')
TERMINAL_EVENTS = {
    'touchdown', 'tackle', 'out_of_bounds', 'qb_sack', 'qb_strip_sack', 'qb_slide', 'qb_kneel', 'qb_spike',
    'pass_outcome_incomplete', 'fair_catch', 'touchback', 'punt_downed', 'safety', 'field_goal',
    'field_goal_missed', 'field_goal_blocked', 'extra_point', 'extra_point_missed',
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

# Retired abbreviations take today's franchise colors; nflverse calls the
# Rams LA, normalized as everywhere else on the site.
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


def offense_wp(home_wp: float | None, offense: str, home: str) -> float | None:
    """nflverse's home win probability from the offense's side."""
    if home_wp is None or (isinstance(home_wp, float) and math.isnan(home_wp)):
        return None
    wp = home_wp if offense == home else 1.0 - home_wp
    return round(wp, 3)


# Frames --------------------------------------------------------------------

def frames_of(rows: list[dict]) -> tuple[dict, dict, list[int]]:
    """Players' and the ball's rows by frame, repeats dropped, and the
    frames that have a ball row, in order."""
    players: dict[str, dict[int, dict]] = {}
    ball: dict[int, dict] = {}
    for row in rows:
        frame = int(row['frame'])
        if row['displayName'] == 'ball':
            ball.setdefault(frame, row)
        elif row['nflId']:
            players.setdefault(row['nflId'], {}).setdefault(frame, row)
    return players, ball, sorted(ball)


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

def nearest(players, ball_row: dict, frame: int) -> str | None:
    bx, by = float(ball_row['x']), float(ball_row['y'])
    best, best_d = None, CARRIER_REACH
    for pid, track in players.items():
        row = track.get(frame)
        if row is None:
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


def carriers_of(players, ball, frames: list[int], events, snapping: str, play_type: str) -> dict[int, str | None]:
    """The ball carrier's nflId (or None) for every frame, by the rules in
    the module docstring."""
    snap = first_event(events, START_EVENTS)
    if snap is None:
        return {frame: None for frame in frames}
    flights = flights_of(events)
    in_flight = lambda f: any(fl['from'] <= f < fl['to'] for fl in flights)
    flight_ends = {fl['to'] for fl in flights}
    dead = first_event(events, DEAD_BALL, after=snap[0])

    holder, release = None, None
    if snap[1] == 'ball_snap':
        position = 'P' if play_type == 'punt' else 'QB'
        holder = holder_at_snap(players, ball[snap[0]], snap[0], snapping, position)
        released = first_event(events, HOLDER_RELEASES, after=snap[0])
        release = released[0] if released else None

    carriers: dict[int, str | None] = {}
    current, candidate, streak = None, None, 0
    landed = False  # a flight has ended and nobody has the ball yet
    for frame in frames:
        if frame in flight_ends:
            landed = True
        if frame < snap[0] or in_flight(frame) or (dead and frame >= dead[0]):
            current, candidate, streak = None, None, 0
        elif holder and (release is None or frame < release):
            current, candidate, streak = holder, None, 0
        else:
            near = nearest(players, ball[frame], frame)
            if landed and current is None:
                current, candidate, streak = near, None, 0
                landed = near is None
            elif near == current:
                candidate, streak = None, 0
            else:
                streak = streak + 1 if near == candidate else 1
                candidate = near
                if streak >= SWITCH_FRAMES:
                    current, candidate, streak = near, None, 0
        carriers[frame] = current
    return carriers


# Building ------------------------------------------------------------------

def team_colors(teams: list[dict]) -> dict[str, dict]:
    return {t['abbr']: {'primary': t['primary'], 'secondary': t['secondary']} for t in teams}


def team_entry(abbr: str, colors: dict[str, dict]) -> dict:
    shown = normalize_team(abbr)
    palette = colors.get(COLOR_TEAM.get(shown, shown), {'primary': '#5b6570', 'secondary': '#ffffff'})
    return {'abbr': shown, **palette}


def build_scene(key: str, rows: list[dict], pbp_row: dict | None, colors: dict[str, dict]) -> dict:
    first = rows[0]
    players, ball, frames = frames_of(rows)
    events = events_of(rows)
    play_type = first['playType'].removeprefix('play_type_')
    kick = play_type in KICK_TYPES
    snapping = next(r['teamAbbr'] for r in rows if num(r['possessionFlag']) == 1)
    other = next(r['teamAbbr'] for r in rows if r['teamAbbr'] and r['teamAbbr'] != snapping)
    offense, defense = (other, snapping) if kick else (snapping, other)
    # playDirection is the snapping team's; on a kick the offense goes the other way.
    flip = (first['playDirection'] == 'left') != kick
    home = next(r['teamAbbr'] for r in rows if num(r['homeTeamFlag']) == 1)
    away = defense if home == offense else offense

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

    order = sorted(players, key=lambda pid: (players[pid][min(players[pid])]['teamAbbr'] != offense, pid))
    scene_players = []
    for pid in order:
        track = players[pid]
        any_row = track[min(track)]
        xs, ys, dirs, os_ = [], [], [], []
        for f in kept:
            row = track.get(f)
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
            'side': 'offense' if any_row['teamAbbr'] == offense else 'defense',
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
    first_down = min(END_LINE, los + to_go) if (los is not None and down and to_go and not kick) else None

    play = play_facts(first, pbp_row, offense, home)
    return {
        'version': FORMAT_VERSION,
        'key': key,
        'source': 'ngs',
        'hz': HZ,
        'scale': SCALE,
        'frameCount': len(kept),
        'play': {**play, 'type': play_type, 'offense': normalize_team(offense), 'defense': normalize_team(defense),
                 'home': normalize_team(home), 'away': normalize_team(away),
                 'kicking': normalize_team(snapping) if kick else None},
        'field': {'lineOfScrimmage': los, 'firstDown': first_down},
        'teams': {'offense': team_entry(offense, colors), 'defense': team_entry(defense, colors)},
        'events': [{'frame': index[f], 'name': name} for f, name in events if f in index],
        'flights': [{**fl, 'from': index[fl['from']], 'to': index[fl['to']]}
                    for fl in flights_of(events) if fl['from'] in index and fl['to'] in index],
        'ball': {'x': ball_x, 'y': ball_y},
        'carrier': [slot.get(carriers.get(f)) for f in kept],
        'players': scene_players,
    }


def play_facts(first: dict, pbp_row: dict | None, offense: str, home: str) -> dict:
    """What the scoreboard shows: NGS's situation before the snap, nflverse's
    description, date, score after and win probability."""
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
        'yardline': first['yardline'] or None,
        'scoreBefore': before,
        'description': first['playDescription'],
        'date': None, 'nflverseGameId': None, 'scoreAfter': None, 'wpBefore': None, 'wpAfter': None,
    }
    if pbp_row is None:
        return facts
    nflverse_home = normalize_team(pbp_row['home_team'])
    if nflverse_home != normalize_team(home):
        raise ValueError(f'{first["gameId"]} {first["playId"]}: home team {home} in NGS, {nflverse_home} in nflverse')
    facts.update({
        'date': pbp_row['game_date'],
        'nflverseGameId': pbp_row['game_id'],
        'description': pbp_row['desc'],
        'scoreAfter': {'home': int(pbp_row['total_home_score']), 'away': int(pbp_row['total_away_score'])},
        'wpBefore': offense_wp(pbp_row['home_wp'], offense, home),
        'wpAfter': offense_wp(pbp_row['home_wp_post'], offense, home),
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


def summary(scene: dict) -> dict:
    """A scene's line in index.json."""
    play = scene['play']
    return {
        'key': scene['key'],
        'date': play['date'],
        'season': play['season'],
        'seasonType': play['seasonType'],
        'week': play['week'],
        'away': play['away'],
        'home': play['home'],
        'offense': play['offense'],
        'defense': play['defense'],
        'type': play['type'],
        'quarter': play['quarter'],
        'clock': play['clock'],
        'down': play['down'],
        'yardsToGo': play['yardsToGo'],
        'description': play['description'],
        'touchdown': any(e['name'] == 'touchdown' for e in scene['events']),
        'wpBefore': play['wpBefore'],
        'wpAfter': play['wpAfter'],
        'seconds': round(scene['frameCount'] / scene['hz'], 1),
    }


# Writing -------------------------------------------------------------------

def write_scene(scene: dict) -> Path:
    path = DATA_DIR / OUT_DIR / 'plays' / f'{scene["key"]}.json'
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(scene, separators=(',', ':'), ensure_ascii=False) + '\n', encoding='utf-8')
    return path


def write_index() -> int:
    """index.json from every scene on disk, oldest first."""
    plays_dir = DATA_DIR / OUT_DIR / 'plays'
    rows = [summary(json.loads(p.read_text(encoding='utf-8'))) for p in sorted(plays_dir.glob('*.json'))]
    rows.sort(key=lambda r: (r['date'] or '', r['key']))
    write_json_if_changed(f'{OUT_DIR}/index.json', {'version': FORMAT_VERSION, 'plays': rows}, records=True)
    return len(rows)


def pbp_lookup(season: int):
    """(old_game_id, play_id) -> play-by-play row for one season."""
    import polars as pl
    from pbp_cache import load_pbp

    pbp = load_pbp(season, stats_season(today_eastern()))
    if pbp is None:
        return {}
    columns = ['old_game_id', 'play_id', 'game_id', 'game_date', 'home_team', 'away_team', 'desc', 'down',
               'ydstogo', 'total_home_score', 'total_away_score', 'home_wp', 'home_wp_post']
    frame = pbp.select(columns).with_columns(pl.col('play_id').cast(pl.Int64))
    return {(r['old_game_id'], r['play_id']): r for r in frame.iter_rows(named=True)}


def all_keys() -> list[str]:
    rows = read_rows(fetch('ngs_highlights_index.tsv').read_text(encoding='utf-8'))
    keys = {f'{r["season"]}_{r["teamAbbr"]}_{r["gameId"]}_{r["playId"]}' for r in rows}
    return sorted(keys)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    parser.add_argument('keys', nargs='*', help='play keys, e.g. 2018_ARI_2018092311_141')
    parser.add_argument('--all', action='store_true', help='every play in the highlights index')
    args = parser.parse_args()
    keys = all_keys() if args.all else args.keys
    if not keys:
        parser.error('give play keys or --all')

    colors = team_colors(json.loads((DATA_DIR / 'teams.json').read_text(encoding='utf-8')))
    lookups: dict[int, dict] = {}
    total = 0
    for key in keys:
        rows = read_rows(fetch(f'{key}.tsv').read_text(encoding='utf-8'))
        first = rows[0]
        season = int(first['season'])
        if season not in lookups:
            lookups[season] = pbp_lookup(season)
        pbp_row = lookups[season].get((first['gameId'], int(first['playId'])))
        if pbp_row is None:
            print(f'{key}: not in nflverse play-by-play, written without its facts', file=sys.stderr)
        elif mismatch := situation_mismatch(first, pbp_row):
            print(f'{key}: situation differs: {mismatch}', file=sys.stderr)
        scene = build_scene(key, rows, pbp_row, colors)
        path = write_scene(scene)
        size = path.stat().st_size
        total += size
        print(f'{key}: {scene["frameCount"]} frames, {len(scene["players"])} players, {size / 1024:.1f} KB')
    count = write_index()
    print(f'{len(keys)} written ({total / 1024:.0f} KB), {count} in the index')


if __name__ == '__main__':
    main()
