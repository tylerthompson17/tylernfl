"""Build src/data/decisions.json: every 4th down and every try after a
touchdown of the season's final games, from nflverse play-by-play, with each
option's win probability from nfl4th (the site's engine, run through
engine.py), what the team did, and whether the choice is graded.

The numbers and the call are nfl4th's, reproduced exactly
(docs/methods/fourth-down-model.md), and the site labels the call "nfl4th's
recommendation". Grading follows docs/model-interface.md section 3:

- a choice is graded when it differs from nfl4th's call by at least
  THRESHOLD in win probability; its cost is the call's WP minus the
  choice's, as of the snap, whatever happened next;
- fakes count as going for it;
- not graded: overtime and 15 seconds or less left (nfl4th computes
  neither), kneels and spikes, plays nullified by a post-snap penalty, a
  choice the model leaves out (a punt where nfl4th has no punt outcomes, a
  field goal over 70 yards), and games already decided (every option under
  2% or every one over 98%).

Messy plays, decided by Tyler (2026-10-22):

- Pre-snap penalties on 4th down (no_play rows whose text has no play
  before the penalty) are not decisions. The snap that follows is graded.
- A delay of game by the offense followed by a punt or field goal is graded
  at the spot before the penalty: backing up is part of the kick. Followed
  by anything else, the snap is graded. Either way the delay is recorded.
- A timeout before the snap is recorded (offense or defense). nflverse's
  timeouts remaining on the snap's row already count it.
- A try repeated after a penalty (a re-kick, or a switch to going for 2)
  keeps the last attempt.

Each run prints how many plays fell in each category (`counts` in the file).

Every run recomputes the whole season, so a new model reaches every play the
next morning; the file names the model version it used.

Each supported 4th down also carries the experimental model's result on the
same situation (`experimental`, contract v5), as the engine returns it with
numbers at five places. It is never graded, counted or summed: grades,
coaches and the summary are nfl4th's alone. It runs on the weekly tables in
models/fourth-down/ as they stand on the day of the run (their `dataAsOf`
week), for every play of the season, and with no punterId, so the punter is
the team's most recent one in teamPunters.json. games.py keeps each play's
last supported result once the model stops supporting the season.

Coaches are credited by game: each decision goes to its team's head coach in
that game (nflverse's home_coach / away_coach), so an interim coach is
ranked for his own games. The leaderboard (`coaches`) counts every
evaluated decision (supported, not decided, a choice the model has a number
for) and sums the cost of the mistakes, those costing THRESHOLD or more. A
clear mistake is one where nfl4th's top two options were CLOSE_MARGIN or more
apart: the model was not torn.
Totals are ranked on their displayed value (points of WP, one place), so
equal totals share a rank. `summary` holds the numbers the page's intro
quotes.
"""

import re

THRESHOLD = 0.02
# A flagged decision is a close call when nfl4th's top two options are
# within this much win probability.
CLOSE_MARGIN = 0.05
DECIDED_LOW, DECIDED_HIGH = 0.02, 0.98
LABEL = "nfl4th's recommendation"

PBP_COLUMNS = [
    'game_id', 'play_id', 'season', 'week', 'season_type', 'posteam', 'defteam', 'home_team', 'away_team',
    'down', 'ydstogo', 'yardline_100', 'qtr', 'game_seconds_remaining', 'half_seconds_remaining',
    'score_differential', 'posteam_timeouts_remaining', 'defteam_timeouts_remaining', 'home_opening_kickoff',
    'roof', 'temp', 'spread_line', 'total_line', 'play_type', 'desc', 'penalty', 'penalty_type', 'penalty_team',
    'timeout', 'timeout_team', 'qb_kneel', 'qb_spike', 'extra_point_attempt', 'two_point_attempt',
    'home_coach', 'away_coach',
]

SNAPS = {'pass', 'run', 'punt', 'field_goal', 'qb_kneel', 'qb_spike', 'kickoff', 'extra_point'}
CALL_OF = {'punt': 'punt', 'field_goal': 'field goal', 'pass': 'go', 'run': 'go'}
FAKE = re.compile(r'(Punt|Field Goal) formation', re.IGNORECASE)
# "(4:17) (Punt formation) " and the like, before the text of the play, and
# announcements that are not plays: "79-L.Borom reported in as eligible."
LEADING_TAGS = re.compile(r'^(\s*\([^)]*\))*\s*')
ANNOUNCEMENTS = re.compile(r'^(.*?reported in as eligible\.\s*)+', re.IGNORECASE)


def normalize(team: str | None) -> str | None:
    from common import normalize_team

    return None if team is None else normalize_team(team)


def is_pre_snap(row: dict) -> bool:
    """A no_play row is a pre-snap foul when no play is described before the
    penalty: "(4:17) (Punt formation) PENALTY on ..., Delay of Game", not
    "(3:02) J.Herbert pass ... PENALTY on ..., Offensive Holding"."""
    rest = LEADING_TAGS.sub('', row.get('desc') or '', count=1)
    rest = ANNOUNCEMENTS.sub('', rest)
    return rest.upper().startswith('PENALTY')


def situation(row: dict, fourth: bool) -> dict:
    """The contract situation (docs/model-interface.md) for a play row, as the
    fourth-down repo's export builds it from nflverse (situations_from_pbp)."""
    posteam = normalize(row['posteam'])
    home = normalize(row['home_team'])
    defteam = normalize(row['away_team']) if posteam == home else home
    s = {
        'season': int(row['season']),
        'posteam': posteam,
        'defteam': defteam,
        'home': home,
        'overtime': (row['qtr'] or 0) >= 5,
        'secondsRemaining': int(row['game_seconds_remaining']),
        'halfSecondsRemaining': int(row['half_seconds_remaining']),
        'scoreDiff': int(row['score_differential']),
        'timeoutsOffense': int(row['posteam_timeouts_remaining']),
        'timeoutsDefense': int(row['defteam_timeouts_remaining']),
        'homeOpeningKickoff': row['home_opening_kickoff'] == 1,
        'roof': row['roof'],
        'spreadLine': None if row['spread_line'] is None else float(row['spread_line']),
        'totalLine': None if row['total_line'] is None else float(row['total_line']),
    }
    if fourth:
        s['yardline100'] = int(row['yardline_100'])
        s['distance'] = int(row['ydstogo'])
        s['temp'] = None if row['temp'] is None else float(row['temp'])
    return s


def find_decisions(rows: list[dict]) -> tuple[list[dict], list[dict], dict[str, int]]:
    """(4th down decisions, try decisions, counts) from one season's plays,
    sorted by game and play id. A decision carries the row to build its
    situation from and what the team did; nothing is computed yet."""
    counts: dict[str, int] = {key: 0 for key in COUNT_KEYS}
    fourth: list[dict] = []
    tries: list[dict] = []
    chain: list[dict] = []
    game = None
    last_try: dict | None = None

    for row in rows:
        if row['game_id'] != game:
            game, chain, last_try = row['game_id'], [], None
        play_type = row.get('play_type')
        down = row.get('down')

        if row.get('timeout') == 1 and play_type in (None, 'no_play') and down is None:
            chain.append(row)
            continue

        if row.get('extra_point_attempt') == 1 or row.get('two_point_attempt') == 1:
            counts['tries'] += 1
            if last_try is not None:
                # The earlier attempt was wiped out or retaken after a penalty.
                tries.remove(last_try)
                counts['tries retaken after a penalty (last attempt kept)'] += 1
            last_try = {'row': row, 'teamCall': 'go for 2' if row.get('two_point_attempt') == 1 else 'kick'}
            tries.append(last_try)
            chain = []
            continue
        if play_type in SNAPS:
            last_try = None

        if down == 4 and play_type == 'no_play':
            counts['4th down rows'] += 1
            if is_pre_snap(row):
                counts['pre-snap penalties before a 4th down snap'] += 1
                chain.append(row)
            else:
                counts['nullified by a post-snap penalty (skipped)'] += 1
                chain = []
            continue

        if down == 4 and play_type in SNAPS:
            counts['4th down rows'] += 1
            if play_type in ('qb_kneel', 'qb_spike'):
                counts['kneels and spikes (skipped)'] += 1
                chain = []
                continue
            call = CALL_OF[play_type]
            fake = call == 'go' and bool(FAKE.search(row.get('desc') or ''))
            delay = next(
                (r for r in chain if r.get('penalty_type') == 'Delay of Game' and r.get('penalty_team') == row['posteam']),
                None,
            )
            base = delay if delay is not None and call in ('punt', 'field goal') else row
            timeouts = [r for r in chain if r.get('timeout') == 1]
            timeout_before = None
            if timeouts:
                timeout_before = 'offense' if timeouts[-1].get('timeout_team') == row['posteam'] else 'defense'
                counts[f'snaps right after a timeout by the {timeout_before}'] += 1
            if fake:
                counts['fakes (counted as go)'] += 1
            if delay is not None:
                counts[
                    'delay of game, then a kick (graded at the spot before it)'
                    if base is delay else 'delay of game, then went for it (graded at the snap)'
                ] += 1
            fourth.append({
                'row': base,
                'snap': row,
                'teamCall': call,
                'fake': fake,
                'delayOfGame': None if delay is None else {
                    'playId': int(delay['play_id']),
                    'yardsBack': int(row['yardline_100'] - delay['yardline_100']),
                },
                'timeoutBefore': timeout_before,
                'presnapPenalties': [r['penalty_type'] for r in chain if r.get('penalty') == 1],
            })
            chain = []
            continue

        if play_type in SNAPS or play_type == 'no_play':
            chain = []
    return fourth, tries, counts


COUNT_KEYS = [
    '4th down rows',
    'pre-snap penalties before a 4th down snap',
    'delay of game, then a kick (graded at the spot before it)',
    'delay of game, then went for it (graded at the snap)',
    'nullified by a post-snap penalty (skipped)',
    'fakes (counted as go)',
    'snaps right after a timeout by the offense',
    'snaps right after a timeout by the defense',
    'kneels and spikes (skipped)',
    'tries',
    'tries retaken after a penalty (last attempt kept)',
    'overtime (not supported)',
    'endgame, 15 seconds or less (not supported)',
    'model unavailable',
    'choice the model leaves out (not graded)',
    'game already decided (not graded)',
    'graded 4th downs',
    'graded tries',
]

FOURTH_WP = {'go': 'wpGo', 'punt': 'wpPunt', 'field goal': 'wpFieldGoal'}
TRY_WP = {'kick': 'wpKick', 'go for 2': 'wpGoForTwo'}


def r5(x: float | None) -> float | None:
    """Five places: far finer than the site shows, and a third the size."""
    return None if x is None else round(x, 5)


def r5_all(value):
    """Every float in a JSON value at five places, the rest unchanged."""
    if isinstance(value, float):
        return round(value, 5)
    if isinstance(value, dict):
        return {k: r5_all(v) for k, v in value.items()}
    if isinstance(value, list):
        return [r5_all(v) for v in value]
    return value


def grade(decision: dict, result: dict, fourth: bool, counts: dict[str, int]) -> dict:
    """A decision's entry in the file, from its engine result."""
    row, snap = decision['row'], decision.get('snap', decision['row'])
    home = snap['posteam'] == snap['home_team']
    entry = {
        'gameId': snap['game_id'],
        'coach': snap.get('home_coach' if home else 'away_coach'),
        'playId': int(snap['play_id']),
        'week': int(snap['week']),
        'description': snap.get('desc'),
        'situation': situation(row, fourth),
        'teamCall': decision['teamCall'],
    }
    if fourth:
        entry |= {
            'fake': decision['fake'],
            'delayOfGame': decision['delayOfGame'],
            'timeoutBefore': decision['timeoutBefore'],
            'presnapPenalties': decision['presnapPenalties'],
        }
    if not result['supported']:
        reason = result['reason']
        counts[{'overtime': 'overtime (not supported)', 'endgame': 'endgame, 15 seconds or less (not supported)'}.get(
            reason, 'model unavailable')] += 1
        return entry | {'call': None, 'wpCost': None, 'graded': False, 'skip': reason}

    keys = FOURTH_WP if fourth else TRY_WP
    wps = {call: result[key] for call, key in keys.items()}
    entry |= {key: r5(result[key]) for key in keys.values()}
    if fourth:
        entry |= {
            'conversionProb': r5(result['conversionProb']),
            'fgMakeProb': r5(result['fgMakeProb']),
            'kickDistance': result['kickDistance'],
            'experimental': r5_all(result['experimental']),
        }
    else:
        entry |= {'patMakeProb': r5(result['patMakeProb']), 'twoPointConvProb': r5(result['twoPointConvProb'])}
    entry['call'] = result['call']
    ranked = sorted((v for v in wps.values() if v is not None), reverse=True)
    entry['margin'] = r5(ranked[0] - ranked[1]) if len(ranked) > 1 else None

    chosen = wps[decision['teamCall']]
    if chosen is None:
        counts['choice the model leaves out (not graded)'] += 1
        return entry | {'wpCost': None, 'graded': False, 'skip': 'null option'}
    cost = wps[result['call']] - chosen
    options = [v for v in wps.values() if v is not None]
    if all(v < DECIDED_LOW for v in options) or all(v > DECIDED_HIGH for v in options):
        counts['game already decided (not graded)'] += 1
        return entry | {'wpCost': r5(cost), 'graded': False, 'skip': 'decided'}
    graded = cost >= THRESHOLD
    if graded:
        counts['graded 4th downs' if fourth else 'graded tries'] += 1
    return entry | {'wpCost': r5(cost), 'graded': graded, 'skip': None}


def evaluated(entry: dict) -> bool:
    """A decision with a cost that counts: supported, a choice the model has a
    number for, and the game not already decided."""
    return entry['wpCost'] is not None and entry['skip'] is None


KICKS = {'punt', 'field goal', 'kick'}
GOES = {'go', 'go for 2'}


def coach_table(entries: list[dict]) -> list[dict]:
    """Every head coach's evaluated decisions, mistakes and WP lost, most
    lost first; equal totals at the displayed precision share a rank."""
    by_coach: dict[str, dict] = {}
    for e in entries:
        if not evaluated(e):
            continue
        c = by_coach.setdefault(e['coach'], {
            'coach': e['coach'], 'teams': [], 'decisions': 0, 'fourthDowns': 0, 'tries': 0, 'mistakes': 0,
            'clearMistakes': 0, 'wpLost': 0.0,
        })
        team = e['situation']['posteam']
        if team not in c['teams']:
            c['teams'].append(team)
        c['decisions'] += 1
        c['fourthDowns' if 'yardline100' in e['situation'] else 'tries'] += 1
        if e['graded']:
            c['mistakes'] += 1
            c['wpLost'] += e['wpCost']
            # Clear: nfl4th's top two options at least CLOSE_MARGIN apart,
            # the complement of the intro's close calls.
            if e['margin'] is not None and e['margin'] >= CLOSE_MARGIN:
                c['clearMistakes'] += 1
    rows = sorted(by_coach.values(), key=lambda c: (-round(c['wpLost'] * 100, 1), c['coach']))
    previous, rank = None, 0
    for i, c in enumerate(rows, start=1):
        shown = round(c['wpLost'] * 100, 1)
        if shown != previous:
            rank, previous = i, shown
        c['rank'] = rank
        c['wpLostPerDecision'] = r5(c['wpLost'] / c['decisions'])
        c['wpLost'] = r5(c['wpLost'])
    return rows


def summary(fourth: list[dict], tries: list[dict]) -> dict:
    """The numbers the page's intro quotes, from the evaluated decisions."""
    downs = [e for e in fourth if evaluated(e)]
    flagged = [e for e in fourth + tries if evaluated(e) and e['graded']]
    share = lambda n, d: r5(n / d) if d else None  # noqa: E731
    kicks = sum(1 for e in flagged if e['teamCall'] in KICKS and e['call'] in GOES)
    close = sum(1 for e in flagged if e['margin'] is not None and e['margin'] < CLOSE_MARGIN)
    return {
        'fourthDowns': len(downs),
        'nfl4thGoShare': share(sum(1 for e in downs if e['call'] == 'go'), len(downs)),
        'coachGoShare': share(sum(1 for e in downs if e['teamCall'] == 'go'), len(downs)),
        'mistakes': len(flagged),
        'kicksModelWouldGo': kicks,
        'kicksModelWouldGoShare': share(kicks, len(flagged)),
        'closeMargin': CLOSE_MARGIN,
        'closeCalls': close,
        'closeCallShare': share(close, len(flagged)),
    }


def build_decisions(rows: list[dict], season: int, updated: str, run=None) -> dict:
    """decisions.json for one season's plays (every final game's rows)."""
    if run is None:
        from engine import run_engine as run
    fourth, tries, counts = find_decisions(rows)
    requests = [{'kind': 'fourth-down', 'situation': situation(d['row'], True)} for d in fourth]
    requests += [{'kind': 'try', 'situation': situation(d['row'], False)} for d in tries]
    model_version, results = run(requests) if requests else (None, [])
    graded_fourth = [grade(d, r, True, counts) for d, r in zip(fourth, results[: len(fourth)])]
    graded_tries = [grade(d, r, False, counts) for d, r in zip(tries, results[len(fourth):])]
    return {
        'season': season,
        'updated': updated,
        'modelVersion': model_version,
        'label': LABEL,
        'threshold': THRESHOLD,
        'games': len({row['game_id'] for row in rows}),
        'counts': counts,
        'summary': summary(graded_fourth, graded_tries),
        'coaches': coach_table(graded_fourth + graded_tries),
        'fourthDowns': graded_fourth,
        'tries': graded_tries,
    }


def final_game_ids(schedule_rows: list[dict], season: int, in_pbp: set[str]) -> set[str]:
    """Every game of `season`, regular season and playoffs, with a final score
    in the schedule that the play-by-play already has."""
    return {
        g['game_id'] for g in schedule_rows
        if g['season'] == season and g['away_score'] is not None and g['home_score'] is not None
        and g['game_id'] in in_pbp
    }


def load_decision_rows(season: int, current_season: int, schedule_rows: list[dict]) -> list[dict]:
    """Plays of every final game of `season`, in game and play order."""
    import polars as pl

    from pbp_cache import load_pbp

    pbp = load_pbp(season, current_season)
    if pbp is None:
        return []
    finals = final_game_ids(schedule_rows, season, set(pbp['game_id'].unique().to_list()))
    return (
        pbp.filter(pl.col('game_id').is_in(list(finals)))
        .select(PBP_COLUMNS)
        .sort(['game_id', 'play_id'])
        .to_dicts()
    )


def report(data: dict) -> str:
    lines = [f"decisions: {data['season']}, {data['games']} games, {len(data['fourthDowns'])} 4th downs, "
             f"{len(data['tries'])} tries"]
    lines += [f'  {key}: {n}' for key, n in data['counts'].items()]
    lines += [f'  summary {key}: {value}' for key, value in data['summary'].items()]
    return '\n'.join(lines)
