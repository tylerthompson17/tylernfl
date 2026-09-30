"""Writes the date state fixtures: the site's data as the pipelines would have
written it at each moment in states.json, from real nflverse data.

The sets are gitignored: scripts/audit-pages.ts --state runs this for a
state the first time it is needed (or with --regenerate). By hand, from the
repo root (never on the site or in CI):
    pipelines/.venv/bin/python tests/fixtures/states/generate.py            # every state
    pipelines/.venv/bin/python tests/fixtures/states/generate.py sunday     # one
    pipelines/.venv/bin/python tests/fixtures/states/generate.py --hash     # the current pipeline hash

nflverse corrects its data now and then, and season rosters are always
today's, so a set generated on another day can differ slightly.
generated.json in each set records when it was made, and the audit's report
carries it.

Each state gets the files of the daily run at 6 AM Eastern that day (10:00
UTC, as .github/workflows/daily.yml), written through TYLERNFL_DATA_DIR into
tests/fixtures/states/<state>/. src/data is never read for results or
written; teams.json, logos.json and performance_percentiles.json are copied
from it, since no daily run writes them.

nflverse publishes results, not history, so anything after the run's moment
is hidden before the pipelines see it: scores of games that had not kicked
off, their player stats, snap counts and plays, and weekly rosters and injury
reports for weeks that had not started (a week counts from 3 days before its
first kickoff). Season rosters and the player table cannot be dated and are
today's.

Betting lines appear about a week before a game (CLAUDE.md), so lines for
games more than LINES_LEAD after the run are hidden too; nflverse keeps
every closing line, which put next season's week 1 lines in June.

generated.json also records pipeline_hash(): a hash of every pipeline file
that shapes the data, this script and states.json. scripts/audit-pages.ts
asks for the current one (generate.py --hash) and regenerates a set whose
hash differs, so a change to the pipelines never leaves a stale set in use.

Afterwards the chart archive is trimmed to today's pick and each team's
newest chart (the home page and team pages), and every `updated` stamp is set
to its run's moment, so the files read as written then.
"""

import hashlib
import json
import os
import shutil
import subprocess
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
PIPELINES = ROOT / 'pipelines'
SOURCE = ROOT / 'src' / 'data'
SEEDS = ['teams.json', 'logos.json', 'performance_percentiles.json']
EASTERN = ZoneInfo('America/New_York')
RESULT_COLUMNS = ['away_score', 'home_score', 'result', 'total', 'overtime']
WEEK_LEAD = timedelta(days=3)
LINES_LEAD = timedelta(days=7)
LINE_COLUMNS = [
    'spread_line', 'away_moneyline', 'home_moneyline', 'away_spread_odds', 'home_spread_odds',
    'total_line', 'under_odds', 'over_odds',
]


def utc(text: str) -> datetime:
    return datetime.fromisoformat(text.replace('Z', '+00:00'))


def stamp(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def run_time(now: datetime) -> datetime:
    """The daily run most recent at or before `now`."""
    daily = now.replace(hour=10, minute=0, second=0, microsecond=0)
    return daily - timedelta(days=1) if daily > now else daily


# ---------------------------------------------------------------- child run

def kickoff(row: dict) -> datetime | None:
    if not row.get('gameday'):
        return None
    hour, minute = (int(x) for x in (row.get('gametime') or '13:00').split(':'))
    day = date.fromisoformat(row['gameday'])
    return datetime(day.year, day.month, day.day, hour, minute, tzinfo=EASTERN)


def install_masks(as_of: datetime) -> None:
    """Replace the nflverse loaders the pipelines call with ones that hide
    everything after `as_of`. The pipelines import nflreadpy and pbp_cache
    inside their functions, so patching the modules reaches every call."""
    import nflreadpy as nfl
    import polars as pl

    import pbp_cache

    real = {name: getattr(nfl, name) for name in (
        'load_schedules', 'load_player_stats', 'load_rosters_weekly', 'load_injuries', 'load_snap_counts')}
    real_pbp = pbp_cache.load_pbp

    games = real['load_schedules'](True).select('game_id', 'season', 'week', 'gameday', 'gametime').to_dicts()
    unplayed, played, first_kickoff, unpriced = set(), set(), {}, set()
    for game in games:
        start = kickoff(game)
        if start is None or start - LINES_LEAD > as_of:
            unpriced.add(game['game_id'])
        if start is None or start >= as_of:
            unplayed.add(game['game_id'])
        else:
            played.add(game['game_id'])
        if start is not None:
            key = (game['season'], game['week'])
            first_kickoff[key] = min(start, first_kickoff.get(key, start))
    started_weeks = {key for key, start in first_kickoff.items() if start - WEEK_LEAD < as_of}

    def load_schedules(*args, **kwargs):
        frame = real['load_schedules'](*args, **kwargs)
        hidden = pl.col('game_id').is_in(list(unplayed))
        too_far = pl.col('game_id').is_in(list(unpriced))
        return frame.with_columns(
            [pl.when(hidden).then(None).otherwise(pl.col(c)).alias(c) for c in RESULT_COLUMNS if c in frame.columns]
            + [pl.when(too_far).then(None).otherwise(pl.col(c)).alias(c) for c in LINE_COLUMNS if c in frame.columns]
        )

    def only_played(frame):
        return frame.filter(pl.col('game_id').is_in(list(played)))

    def load_player_stats(*args, **kwargs):
        return only_played(real['load_player_stats'](*args, **kwargs))

    def load_snap_counts(*args, **kwargs):
        return only_played(real['load_snap_counts'](*args, **kwargs))

    def by_started_week(loader):
        def load(season, *args, **kwargs):
            frame = loader(season, *args, **kwargs)
            weeks = [week for (s, week) in started_weeks if s == season]
            return frame.filter(pl.col('week').is_in(weeks))
        return load

    def load_pbp(season, current_season):
        pbp = real_pbp(season, current_season)
        return None if pbp is None else only_played(pbp)

    nfl.load_schedules = load_schedules
    nfl.load_player_stats = load_player_stats
    nfl.load_snap_counts = load_snap_counts
    nfl.load_rosters_weekly = by_started_week(real['load_rosters_weekly'])
    nfl.load_injuries = by_started_week(real['load_injuries'])
    pbp_cache.load_pbp = load_pbp


def child(as_of: datetime) -> None:
    sys.path.insert(0, str(PIPELINES))
    install_masks(as_of)
    import run_daily
    sys.argv = ['run_daily.py', '--today', as_of.astimezone(EASTERN).date().isoformat()]
    run_daily.main()


# --------------------------------------------------------------- parent run

def run(as_of: datetime, out: Path) -> None:
    print(f'  daily run as of {stamp(as_of)}', flush=True)
    env = {**os.environ, 'TYLERNFL_DATA_DIR': str(out), 'MPLBACKEND': 'Agg'}
    subprocess.run(
        [sys.executable, __file__, '--child', stamp(as_of)],
        cwd=ROOT, env=env, check=True,
    )


def trim_charts(out: Path) -> None:
    archive = out / 'charts' / 'archive'
    if not archive.exists():
        return
    auto = out / 'charts' / 'auto.json'
    keep = {json.loads(auto.read_text())['slug']} if auto.exists() else set()
    newest: dict[str, tuple[str, str]] = {}
    for path in archive.glob('*.json'):
        if path.name.endswith('.hover.json'):
            continue
        entry = json.loads(path.read_text())
        slug = path.name.removesuffix('.json')
        for team in entry.get('teams') or []:
            newest[team] = max(newest.get(team, ('', '')), (entry['date'], slug))
    keep |= {slug for _, slug in newest.values()}
    for path in archive.iterdir():
        slug = path.name.split('.')[0]
        if slug not in keep:
            path.unlink()


def restamp(out: Path, daily: datetime) -> None:
    for path in out.rglob('*.json'):
        text = path.read_text()
        data = json.loads(text)
        if not isinstance(data, dict) or 'updated' not in data:
            continue
        data['updated'] = stamp(daily)
        compact = '\n' not in text.strip()
        path.write_text(json.dumps(data, separators=(',', ':')) if compact
                        else json.dumps(data, indent=2, ensure_ascii=False) + '\n')


def pipeline_hash() -> str:
    """Every file whose change can change a set: the pipelines (not their
    tests, not Tyler's chart scripts in charts/mine/, which the daily run does
    not use), this script and states.json."""
    files = sorted(
        path for path in PIPELINES.rglob('*.py')
        if not path.name.startswith('test_')
        and not any(part in ('.venv', '.cache', '__pycache__', 'mine') for part in path.relative_to(PIPELINES).parts)
    ) + [Path(__file__).resolve(), HERE / 'states.json']
    digest = hashlib.sha256()
    for path in files:
        digest.update(str(path.relative_to(ROOT)).encode() + b'\0' + path.read_bytes() + b'\0')
    return digest.hexdigest()[:16]


def generate(name: str, state: dict) -> None:
    now = utc(state['now'])
    daily = run_time(now)
    out = HERE / name
    print(f'{name}: site time {stamp(now)}', flush=True)
    if out.exists():
        shutil.rmtree(out)
    (out / 'charts' / 'archive').mkdir(parents=True)
    for seed in SEEDS:
        shutil.copy(SOURCE / seed, out / seed)
    run(daily, out)
    trim_charts(out)
    restamp(out, daily)
    (out / 'generated.json').write_text(json.dumps({
        'generated': stamp(datetime.now(timezone.utc)),
        'dailyRun': stamp(daily),
        'pipelineHash': pipeline_hash(),
    }, indent=2) + '\n')


def main() -> None:
    if sys.argv[1:2] == ['--hash']:
        print(pipeline_hash())
        return
    if sys.argv[1:2] == ['--child']:
        child(utc(sys.argv[2]))
        return
    states = json.loads((HERE / 'states.json').read_text())
    for name in sys.argv[1:] or list(states):
        if name not in states:
            sys.exit(f'No state {name!r} in states.json')
        generate(name, states[name])


if __name__ == '__main__':
    main()
