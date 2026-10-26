"""Build src/data/games/{game_id}.json: one file per final, for its game page.

Each file stands on its own (the page for an old season still has its
score, lines and label after schedule.json moves on), from nflverse only:
- the result: kickoff, scores, overtime, neutral site, nflverse's closing lines
  (`spreadLine` is points the home team is favored by), the excitement
  index and label from game_excitement.json's rules;
- the line score: each team's points per period, from the running score
  on the last play of each quarter (overtime periods after the fourth);
- team box stats from play-by-play, with team_stats.py's definitions where
  it has one (EPA per play, success rate, third downs, red zone trips),
  plus:
  - plays and yards: snaps with a down that are passes (sacks included,
    their yards lost counted), runs, kneels or spikes; a play wiped out by
    a penalty is `no_play` and is not one. Passing and rushing yards split
    on `play_type`.
  - first downs: nflverse's `first_down` on the offense's plays, penalty
    first downs included, as the NFL counts them.
  - fourth downs: `fourth_down_converted` over converted plus failed, as
    third downs.
  - turnovers: interceptions thrown on snaps (`interception`, not on a two
    point try) and fumbles lost by the team that fumbled (`fumble_lost`
    with `fumbled_1_team`, so a muffed punt counts against the receiving
    team).
  - time of possession: nflverse's `drive_time_of_possession`, once per
    NFL drive (`drive`), added up by the drive's offense.
- player stats per board (passing, rushing, receiving, defense, kicking)
  from nflverse's weekly player stats through leaderboards.board_values,
  so a game's line is the row its player's game log carries. Rows are
  arrays in the board's column order. Null until nflverse publishes the
  week's stats, which can trail the play-by-play.
- the five plays with the largest change in nflfastR's home win
  probability, either way (`home_wp` before, after as the WP chart's line
  holds it, excitement.line_wps, so a play with no after value such as a
  pre-snap foul counts, and a timeout or marker row never does);
- the game's 4th down and try records from decisions.json, copied as they
  are (with the file's model version and closeMargin), so a past season's
  page keeps its calls after decisions.json moves on; and where each sits
  on the win probability chart: minutes since kickoff
  (excitement.play_minutes, the chart's x) and home win probability
  before the snap.

Written compactly (a season is about 285 files). Every game of the season
is recomputed each run; write_json_if_changed leaves an unchanged one
alone, and files of earlier seasons are kept.
"""

from collections import defaultdict

from common import normalize_team
from excitement import is_stoppage, line_wps, play_minutes, wp_plays
from leaderboards import BOARDS, STAT_COLUMNS, board_values
from team_stats import is_epa_play

BIG_PLAYS = 5

PBP_COLUMNS = [
    'game_id', 'season_type', 'play_id', 'qtr', 'time', 'game_seconds_remaining', 'home_wp', 'home_wp_post',
    'total_away_score', 'total_home_score', 'posteam', 'defteam', 'down', 'play_type', 'pass', 'rush',
    'qb_kneel', 'qb_spike', 'epa', 'yards_gained', 'first_down', 'third_down_converted', 'third_down_failed',
    'fourth_down_converted', 'fourth_down_failed', 'fixed_drive', 'drive', 'drive_inside20',
    'drive_time_of_possession', 'touchdown', 'td_team', 'interception', 'fumble_lost', 'fumbled_1_team',
    'two_point_attempt', 'desc', 'timeout',
]

SNAPS = ('pass', 'run', 'qb_kneel', 'qb_spike')

# Board columns shown in a box score: everything but games played.
BOX_COLUMNS = {b.key: [c.key for c in b.columns if c.key != 'games'] for b in BOARDS}
# Any counted stat puts a player in a board's table, as in the game logs.
COUNTING = {b.key: tuple(c.key for c in b.columns if c.per_game) for b in BOARDS}
# Most of the board's main stat first; defense by tackles, since most
# defenders have no sack.
SORT = {b.key: (b.primary,) for b in BOARDS} | {'defense': ('def_tackles_solo', 'def_tackle_assists')}


def file_name(game_id: str) -> str:
    return f'games/{game_id}.json'


def clock_seconds(text: str | None) -> int:
    """'1:52' or '01:52' as seconds; 0 for anything unreadable."""
    minutes, _, seconds = (text or '').partition(':')
    try:
        return int(minutes) * 60 + int(seconds)
    except ValueError:
        return 0


def line_score(plays: list[dict], away_score: int, home_score: int) -> dict | None:
    """Each side's points per period, or None when they do not add up to the final."""
    ordered = sorted(plays, key=lambda p: p['play_id'])
    periods = max((int(p['qtr']) for p in ordered if p.get('qtr')), default=0)
    away, home = [], []
    before = (0, 0)
    for q in range(1, max(periods, 4) + 1):
        in_period = [p for p in ordered if p.get('qtr') == q and p.get('total_home_score') is not None]
        end = (int(in_period[-1]['total_away_score']), int(in_period[-1]['total_home_score'])) if in_period else before
        away.append(end[0] - before[0])
        home.append(end[1] - before[1])
        before = end
    if (sum(away), sum(home)) != (away_score, home_score):
        return None
    return {'away': away, 'home': home}


def team_box(plays: list[dict], team: str) -> dict:
    """One team's box stats from its game's plays (definitions in the docstring)."""
    out = defaultdict(float)
    epa, success = [], 0
    drives_top: dict[int, int] = {}
    red_zone: dict[int, list[bool]] = {}
    for p in plays:
        offense = p.get('posteam') and normalize_team(p['posteam'])
        if p.get('fumble_lost') == 1 and p.get('fumbled_1_team') and normalize_team(p['fumbled_1_team']) == team:
            out['turnovers'] += 1
        if offense != team:
            continue
        if p.get('drive') is not None and p.get('drive_time_of_possession'):
            drives_top[int(p['drive'])] = clock_seconds(p['drive_time_of_possession'])
        if p.get('down') is None:
            continue
        if p.get('interception') == 1 and p.get('two_point_attempt') != 1:
            out['turnovers'] += 1
        if p.get('play_type') in SNAPS:
            out['plays'] += 1
            yards = p.get('yards_gained') or 0
            out['yards'] += yards
            out['passYards' if p['play_type'] in ('pass', 'qb_spike') else 'rushYards'] += yards
        if p.get('first_down') == 1:
            out['firstDowns'] += 1
        if is_epa_play(p):
            epa.append(p['epa'])
            success += p['epa'] > 0
        for down, key in ((3, 'third'), (4, 'fourth')):
            if p['down'] == down and (p.get(f'{key}_down_converted') == 1 or p.get(f'{key}_down_failed') == 1):
                out[f'{key}Att'] += 1
                out[f'{key}Conv'] += p.get(f'{key}_down_converted') == 1
        drive = red_zone.setdefault(p['fixed_drive'], [False, False])
        if p.get('drive_inside20') == 1:
            drive[0] = True
        if p.get('touchdown') == 1 and p.get('td_team') and normalize_team(p['td_team']) == team:
            drive[1] = True
    trips = [td for inside, td in red_zone.values() if inside]
    return {
        'plays': int(out['plays']),
        'yards': int(out['yards']),
        'passYards': int(out['passYards']),
        'rushYards': int(out['rushYards']),
        'firstDowns': int(out['firstDowns']),
        'epaPerPlay': round(sum(epa) / len(epa), 3) if epa else None,
        'successRate': round(success / len(epa), 3) if epa else None,
        'thirdDowns': [int(out['thirdConv']), int(out['thirdAtt'])],
        'fourthDowns': [int(out['fourthConv']), int(out['fourthAtt'])],
        'redZone': [sum(trips), len(trips)],
        'turnovers': int(out['turnovers']),
        'timeOfPossession': sum(drives_top.values()),
    }


def big_plays(plays: list[dict]) -> list[dict]:
    """The plays that moved home win probability most, either way, in game order."""
    swings = []
    ordered = wp_plays(plays)
    for p, after in zip(ordered, line_wps(ordered)):
        swing = after - p['home_wp']
        if is_stoppage(p) or not p.get('desc') or abs(swing) < 0.005:
            continue
        swings.append((abs(swing), p, after))
    top = sorted(swings, key=lambda s: (-s[0], s[1]['play_id']))[:BIG_PLAYS]
    return [
        {
            'playId': int(p['play_id']),
            'quarter': int(p['qtr']),
            'clock': p.get('time') or '',
            'offense': normalize_team(p['posteam']) if p.get('posteam') else None,
            'description': p['desc'],
            'homeWpBefore': round(p['home_wp'], 4),
            'homeWpAfter': round(after, 4),
        }
        for _, p, after in sorted(top, key=lambda s: s[1]['play_id'])
    ]


def decision_spots(plays: list[dict], play_ids: set[int]) -> list[dict]:
    """Chart positions of the given plays: minutes since kickoff and home WP before the snap."""
    return [
        {'playId': int(p['play_id']), 'x': round(play_minutes(p), 4), 'y': round(p['home_wp'], 4)}
        for p in wp_plays(plays)
        if int(p['play_id']) in play_ids
    ]


def player_tables(rows: list[dict]) -> dict[str, list[list]] | None:
    """Each board's rows for one game, most of its main stat first; None without stats yet."""
    if not rows:
        return None
    tables: dict[str, list[list]] = {}
    for board in BOARDS:
        out = []
        for r in rows:
            if r['player_id'] is None:
                continue
            sums = {c: r.get(c) or 0 for c in STAT_COLUMNS}
            maxes = {c: [r.get(c)] for c in STAT_COLUMNS}
            values = board_values(board, sums, maxes, 1, COUNTING[board.key])
            if values is None:
                continue
            out.append([r['player_id'], r['player_display_name'], normalize_team(r['team']),
                        *(values[k] for k in BOX_COLUMNS[board.key])])
        at = [3 + BOX_COLUMNS[board.key].index(key) for key in SORT[board.key]]
        tables[board.key] = sorted(out, key=lambda row: (-sum(row[i] or 0 for i in at), row[1]))
    return tables


def build_game(schedule: dict, plays: list[dict], player_rows: list[dict],
               calls: dict | None, excitement: dict | None) -> dict:
    """The GameData shape in src/data/types.ts for one final. `calls` is the
    game's decisions snapshot (decisions_for), or None for none yet."""
    decision_ids = {d['playId'] for d in (calls['fourthDowns'] + calls['tries'])} if calls else set()
    away, home = normalize_team(schedule['away_team']), normalize_team(schedule['home_team'])
    a, h = int(schedule['away_score']), int(schedule['home_score'])
    return {
        'id': schedule['game_id'],
        'season': int(schedule['season']),
        'week': int(schedule['week']),
        'type': schedule['game_type'],
        'kickoff': schedule.get('kickoff'),
        'away': away,
        'home': home,
        'awayScore': a,
        'homeScore': h,
        'overtime': bool(schedule.get('overtime')),
        'neutral': schedule.get('location') == 'Neutral',
        'spreadLine': schedule.get('spread_line'),
        'totalLine': schedule.get('total_line'),
        'excitement': excitement and {k: excitement[k] for k in ('index', 'winnerLowWp', 'label')},
        'lineScore': line_score(plays, a, h),
        'teams': {'away': team_box(plays, away), 'home': team_box(plays, home)},
        'players': player_tables(player_rows),
        'bigPlays': big_plays(plays),
        'decisions': calls,
        'decisionSpots': decision_spots(plays, decision_ids),
    }


def decisions_for(decisions: dict) -> dict[str, dict]:
    """Each game's records from decisions.json, unchanged, in the file's
    order, with what the page needs to read them."""
    games: dict[str, dict] = {}
    for kind in ('fourthDowns', 'tries'):
        for d in decisions[kind]:
            game = games.setdefault(d['gameId'], {
                'modelVersion': decisions.get('modelVersion'),
                'closeMargin': decisions['summary']['closeMargin'],
                'fourthDowns': [],
                'tries': [],
            })
            game[kind].append(d)
    return games


def build_games(played: list[tuple[dict, list[dict]]], player_rows: list[dict],
                decisions: dict | None, excitement: dict,
                kept: dict[str, dict] | None = None) -> dict[str, dict]:
    """Every final with play-by-play, keyed by game id. `played` is run_daily's
    (schedule row, plays) pairs; the plays need PBP_COLUMNS (load_game_plays).
    `decisions` is decisions.json when it is these games' season, else None.
    A game this run has no records for keeps the snapshot already in its
    file (`kept`, game id to records), so a snapshot is never lost."""
    by_game: dict[str, list[dict]] = defaultdict(list)
    for r in player_rows:
        by_game[r['game_id']].append(r)
    calls = decisions_for(decisions) if decisions else {}
    kept = kept or {}
    labels = {g['id']: g for g in excitement['games']}
    return {
        row['game_id']: build_game(row, plays, by_game.get(row['game_id'], []),
                                   calls.get(row['game_id']) or kept.get(row['game_id']),
                                   labels.get(row['game_id']))
        for row, plays in played
    }


def kept_decisions(game_ids: list[str]) -> dict[str, dict]:
    """The decisions snapshot already in each game's file, where there is one."""
    import json

    from common import DATA_DIR

    kept = {}
    for game_id in game_ids:
        path = DATA_DIR / file_name(game_id)
        if path.exists():
            snapshot = json.loads(path.read_text(encoding='utf-8')).get('decisions')
            if snapshot:
                kept[game_id] = snapshot
    return kept


def load_game_plays(finals: list[dict], season: int, current_season: int) -> list[tuple[dict, list[dict]]]:
    """Each final nflverse has play-by-play for, with every play and the
    columns above. The schedule rows carry a UTC kickoff (`kickoff`)."""
    if not finals:
        return []
    from pbp_cache import load_pbp
    import polars as pl

    from ticker import kickoff_utc

    pbp = load_pbp(season, current_season)
    if pbp is None:
        return []
    columns = [c for c in PBP_COLUMNS if c in pbp.columns]
    rows = pbp.filter(pl.col('game_id').is_in([r['game_id'] for r in finals])).select(columns)
    plays: dict[str, list[dict]] = defaultdict(list)
    for p in rows.to_dicts():
        plays[p['game_id']].append(p)
    return [({**r, 'kickoff': kickoff_utc(r)}, plays[r['game_id']]) for r in finals if plays.get(r['game_id'])]


def check(games: dict[str, dict]) -> list[str]:
    """Problems worth a warning in the run's log: a line score that does not add up,
    a time of possession far from the game's length."""
    problems = []
    for game_id, g in games.items():
        if g['lineScore'] is None:
            problems.append(f'{game_id}: line score does not add up to the final')
        top = g['teams']['away']['timeOfPossession'] + g['teams']['home']['timeOfPossession']
        length = 3600 + (600 * (len(g['lineScore']['away']) - 4) if g['lineScore'] else 0)
        if not g['overtime'] and abs(top - length) > 120:
            problems.append(f'{game_id}: time of possession adds to {top // 60}:{top % 60:02d}')
    return problems

