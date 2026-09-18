"""Build src/data/team_stats.json from nflverse play-by-play.

Regular season only, one entry per team, each metric with a 1 to 32 rank.
Before a new season has play-by-play, the previous season's final numbers
stay up.

Definitions (plays with a null `down` are kickoffs, extra points and two
point tries, and never count):
- EPA per play: mean `epa` over dropbacks and designed runs (`pass` or
  `rush`), without kneels and spikes. Penalty plays that nflverse still
  flags as a pass or rush count, the usual convention.
- Success rate: share of those same plays with `epa` > 0.
- Third down conversion rate: nflverse's third_down_converted over
  converted plus failed. The flags sit on the play that settles the down,
  so a penalty that replays third down is not an extra attempt.
- Red zone TD rate: of drives that got inside the opponent's 20, the share
  where the offense scored a touchdown. "Inside the 20" is nflverse's own
  drive_inside20 flag rather than a definition of this site's; the 20-yard
  line itself does not count. A drive is (game_id,
  fixed_drive); the touchdown is a play with `touchdown` set and `td_team`
  equal to the offense, so a pick six does not count. (Until 2026-09-18
  this counted drives with a snap at or inside the 20, about 3% more
  trips.)

Only complete weeks count: a week is in once every one of its regular
season games has a final score in the nflverse schedule, so a run on a
Friday never shows "through week 2" with one game of it played.

Offense is grouped by `posteam`, defense by `defteam`. Defensive ranks
invert: 1 is the fewest EPA, conversions and touchdowns allowed.
"""

from collections import defaultdict

from common import normalize_team

# Both formats show three decimals of the stored value: signed3 as +0.155,
# percent1 as 49.8%. Keep in step with formatStat in src/utils/format.ts.
DISPLAY_DECIMALS = 3

# key, label, column header, side, format, better, sample noun, description
METRICS = [
    ('off_epa', 'EPA per play', 'EPA/play', 'offense', 'signed3', 'high', 'plays',
     'Expected points added per dropback or designed run.'),
    ('off_success', 'Success rate', 'Success', 'offense', 'percent1', 'high', 'plays',
     'Share of dropbacks and designed runs that added expected points.'),
    ('off_third_down', 'Third down conversion rate', '3rd down', 'offense', 'percent1', 'high', 'attempts',
     'Third downs converted to a first down or touchdown.'),
    ('off_red_zone', 'Red zone TD rate', 'Red zone TD', 'offense', 'percent1', 'high', 'trips',
     "Share of drives reaching inside the opponent's 20 (nflverse's drive flag) that ended in a touchdown."),
    ('def_epa', 'EPA per play allowed', 'EPA/play', 'defense', 'signed3', 'low', 'plays',
     'Expected points added per opponent dropback or designed run.'),
    ('def_success', 'Success rate allowed', 'Success', 'defense', 'percent1', 'low', 'plays',
     'Share of opponent dropbacks and designed runs that added expected points.'),
    ('def_third_down', 'Third down conversion rate allowed', '3rd down', 'defense', 'percent1', 'low', 'attempts',
     'Opponent third downs converted to a first down or touchdown.'),
    ('def_red_zone', 'Red zone TD rate allowed', 'Red zone TD', 'defense', 'percent1', 'low', 'trips',
     "Share of opponent drives reaching inside the 20 (nflverse's drive flag) that ended in a touchdown."),
]

PBP_COLUMNS = [
    'game_id', 'week', 'posteam', 'defteam', 'down', 'pass', 'rush',
    'qb_kneel', 'qb_spike', 'epa', 'third_down_converted', 'third_down_failed',
    'fixed_drive', 'drive_inside20', 'touchdown', 'td_team',
]


class Tally:
    """Running numerator and denominator for one rate."""

    def __init__(self) -> None:
        self.total = 0.0
        self.n = 0

    def add(self, value: float) -> None:
        self.total += value
        self.n += 1

    def rate(self) -> float | None:
        return self.total / self.n if self.n else None


def is_epa_play(row: dict) -> bool:
    return (
        (row['pass'] == 1 or row['rush'] == 1)
        and row['epa'] is not None
        and row['qb_kneel'] != 1
        and row['qb_spike'] != 1
    )


def rank(values: dict[str, float | None], better: str) -> dict[str, int | None]:
    """1 is best; tied values share a rank (1, 2, 2, 4); teams without a value are unranked."""
    sign = -1 if better == 'high' else 1
    present = [v for v in values.values() if v is not None]
    return {
        team: None if v is None else 1 + sum(1 for other in present if sign * other < sign * v)
        for team, v in values.items()
    }


def build_team_stats(rows: list[dict], season: int, updated: str) -> dict:
    """Pure function from regular season pbp rows to the TeamStatsData shape in src/data/types.ts."""
    tallies: dict[tuple[str, str], Tally] = defaultdict(Tally)
    games: dict[str, set[str]] = defaultdict(set)
    # (game_id, fixed_drive) -> [offense, defense, reached red zone, offensive TD]
    drives: dict[tuple[str, int], list] = {}

    for row in rows:
        if row['down'] is None or row['posteam'] is None or row['defteam'] is None:
            continue
        off, dfn = normalize_team(row['posteam']), normalize_team(row['defteam'])
        games[off].add(row['game_id'])
        games[dfn].add(row['game_id'])

        if is_epa_play(row):
            for side, team in (('off', off), ('def', dfn)):
                tallies[(f'{side}_epa', team)].add(row['epa'])
                tallies[(f'{side}_success', team)].add(1.0 if row['epa'] > 0 else 0.0)

        if row['down'] == 3 and (row['third_down_converted'] == 1 or row['third_down_failed'] == 1):
            converted = 1.0 if row['third_down_converted'] == 1 else 0.0
            tallies[('off_third_down', off)].add(converted)
            tallies[('def_third_down', dfn)].add(converted)

        drive = drives.setdefault((row['game_id'], row['fixed_drive']), [off, dfn, False, False])
        if row['drive_inside20'] == 1:
            drive[2] = True
        if row['touchdown'] == 1 and row['td_team'] is not None and normalize_team(row['td_team']) == off:
            drive[3] = True

    for off, dfn, red_zone, touchdown in drives.values():
        if red_zone:
            tallies[('off_red_zone', off)].add(1.0 if touchdown else 0.0)
            tallies[('def_red_zone', dfn)].add(1.0 if touchdown else 0.0)

    teams = sorted(games)
    values: dict[str, dict[str, dict]] = {team: {} for team in teams}
    for key, _, _, _, _, better, _, _ in METRICS:
        rates = {team: tallies[(key, team)].rate() for team in teams}
        # Rounded to what the site shows (+0.155, 49.8%) before ranking, so two
        # teams showing the same value always share a rank.
        rates = {team: None if r is None else round(r, DISPLAY_DECIMALS) for team, r in rates.items()}
        ranks = rank(rates, better)
        for team in teams:
            values[team][key] = {'value': rates[team], 'rank': ranks[team], 'n': tallies[(key, team)].n}

    return {
        'season': season,
        'throughWeek': max((r['week'] for r in rows), default=0),
        'updated': updated,
        'metrics': [
            {
                'key': key,
                'label': label,
                'short': short,
                'side': side,
                'format': fmt,
                'betterWhen': better,
                'sample': sample,
                'description': description,
            }
            for key, label, short, side, fmt, better, sample, description in METRICS
        ],
        'teams': [{'abbr': team, 'games': len(games[team]), 'values': values[team]} for team in teams],
    }


def last_complete_week(schedule_rows: list[dict]) -> int:
    """Latest regular season week with every game final, counting up from week 1 without gaps."""
    weeks: dict[int, bool] = {}
    for game in schedule_rows:
        if game['game_type'] != 'REG':
            continue
        final = game['away_score'] is not None and game['home_score'] is not None
        weeks[game['week']] = weeks.get(game['week'], True) and final
    complete = 0
    for week in sorted(weeks):
        if week != complete + 1 or not weeks[week]:
            break
        complete = week
    return complete


def load_team_stats_rows(season: int, current_season: int) -> list[dict]:
    import nflreadpy as nfl
    import polars as pl

    from pbp_cache import load_pbp

    pbp = load_pbp(season, current_season)
    if pbp is None:
        return []
    schedule = nfl.load_schedules(season).select('game_type', 'week', 'away_score', 'home_score').to_dicts()
    through = last_complete_week(schedule)
    return (
        pbp.filter((pl.col('season_type') == 'REG') & (pl.col('week') <= through))
        .select(PBP_COLUMNS)
        .to_dicts()
    )
