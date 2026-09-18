"""Tests for the site data pipelines. No network or third party packages needed.

Run from the repo root:
    python -m unittest discover -s pipelines
"""

import unittest
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from common import player_slug
from leaders import build_leaders
from pbp_cache import is_fresh
from rosters import age_on, build_rosters, unknown_statuses
from team_stats import build_team_stats, rank
from ticker import WeekSpan, build_ticker, format_detail, kickoff_utc, next_opener, select_week

d = date.fromisoformat

# Real calendar shapes: the 2025 season (Thursday opener, Super Bowl on
# 2026-02-08) and the start of 2026 (Wednesday opener).
WEEKS = [
    WeekSpan(2025, 1, d('2025-09-04'), d('2025-09-08'), False),
    WeekSpan(2025, 2, d('2025-09-11'), d('2025-09-15'), False),
    WeekSpan(2025, 18, d('2026-01-03'), d('2026-01-04'), False),
    WeekSpan(2025, 19, d('2026-01-10'), d('2026-01-12'), False),
    WeekSpan(2025, 20, d('2026-01-17'), d('2026-01-18'), False),
    WeekSpan(2025, 21, d('2026-01-25'), d('2026-01-25'), False),
    WeekSpan(2025, 22, d('2026-02-08'), d('2026-02-08'), True),
    WeekSpan(2026, 1, d('2026-09-09'), d('2026-09-14'), False),
    WeekSpan(2026, 2, d('2026-09-17'), d('2026-09-21'), False),
]


def picked(today: str, weeks=WEEKS):
    week = select_week(weeks, d(today))
    return None if week is None else (week.season, week.week)


class SelectWeekTest(unittest.TestCase):
    def test_tuesday_shows_the_week_that_just_ended(self):
        self.assertEqual(picked('2025-09-09'), (2025, 1))

    def test_wednesday_shows_the_upcoming_week(self):
        self.assertEqual(picked('2025-09-10'), (2025, 2))

    def test_sunday_and_monday_show_the_week_in_progress(self):
        self.assertEqual(picked('2025-09-14'), (2025, 2))
        self.assertEqual(picked('2025-09-15'), (2025, 2))

    def test_bye_week_before_the_super_bowl_shows_the_super_bowl(self):
        self.assertEqual(picked('2026-01-28'), (2025, 22))
        self.assertEqual(picked('2026-02-03'), (2025, 22))

    def test_tuesday_after_the_super_bowl_still_shows_it(self):
        self.assertEqual(picked('2026-02-10'), (2025, 22))

    def test_offseason_after_the_super_bowl(self):
        self.assertIsNone(picked('2026-02-11'))
        self.assertIsNone(picked('2026-07-15'))
        self.assertEqual(next_opener(WEEKS, d('2026-07-15')).first_day, d('2026-09-09'))

    def test_opener_week_starts_the_season(self):
        self.assertIsNone(picked('2026-09-07'))
        self.assertEqual(picked('2026-09-08'), (2026, 1))
        self.assertEqual(picked('2026-09-09'), (2026, 1))

    def test_unscheduled_playoff_round_keeps_the_last_week(self):
        regular_season_only = [w for w in WEEKS if w.season == 2025 and w.week <= 18]
        self.assertEqual(picked('2026-01-07', regular_season_only), (2025, 18))


class FormatDetailTest(unittest.TestCase):
    def game(self, **overrides):
        base = {'gameday': '2025-09-14', 'gametime': '13:00', 'away_score': None, 'home_score': None, 'overtime': None}
        return {**base, **overrides}

    def test_upcoming_kickoffs(self):
        self.assertEqual(format_detail(self.game()), 'Sun 1:00 PM')
        self.assertEqual(format_detail(self.game(gametime='09:30')), 'Sun 9:30 AM')
        self.assertEqual(format_detail(self.game(gametime='12:00')), 'Sun 12:00 PM')
        self.assertEqual(format_detail(self.game(gameday='2025-09-15', gametime='20:15')), 'Mon 8:15 PM')
        self.assertEqual(format_detail(self.game(gametime=None)), 'Sun TBD')

    def test_finals(self):
        self.assertEqual(format_detail(self.game(away_score=20, home_score=17, overtime=0)), 'Final')
        self.assertEqual(format_detail(self.game(away_score=23, home_score=20, overtime=1)), 'Final/OT')


class KickoffTest(unittest.TestCase):
    def test_eastern_kickoff_to_utc_across_daylight_saving(self):
        self.assertEqual(kickoff_utc({'gameday': '2026-09-17', 'gametime': '20:15'}), '2026-09-18T00:15:00Z')
        self.assertEqual(kickoff_utc({'gameday': '2026-11-08', 'gametime': '13:00'}), '2026-11-08T18:00:00Z')

    def test_unscheduled_kickoff(self):
        self.assertIsNone(kickoff_utc({'gameday': '2027-01-16', 'gametime': None}))


class NoEspnInPipelinesTest(unittest.TestCase):
    def test_pipelines_never_fetch_espn(self):
        # ESPN data is browser-only (the live ticker). Pipelines use nflverse.
        for source in Path(__file__).resolve().parent.glob('*.py'):
            if source.name == Path(__file__).name:
                continue
            self.assertNotIn('espn.com', source.read_text(encoding='utf-8').lower(), source.name)


class BuildTickerTest(unittest.TestCase):
    def row(self, game_id, gameday, gametime, away, home, away_score=None, home_score=None, espn=None):
        return {
            'game_id': game_id, 'season': 2026, 'game_type': 'REG', 'week': 2,
            'gameday': gameday, 'gametime': gametime, 'away_team': away, 'home_team': home,
            'away_score': away_score, 'home_score': home_score, 'overtime': 0, 'espn': espn,
        }

    def test_kickoff_and_espn_id_fields(self):
        rows = [self.row('2026_02_DET_BUF', '2026-09-17', '20:15', 'DET', 'BUF', espn='401872932')]
        game = build_ticker(rows, d('2026-09-16'))['games'][0]
        self.assertEqual(game['kickoff'], '2026-09-18T00:15:00Z')
        self.assertEqual(game['espnId'], '401872932')

    def test_week_games_in_kickoff_order_with_rams_as_lar(self):
        rows = [
            self.row('2026_02_SF_LA', '2026-09-20', '16:25', 'SF', 'LA'),
            self.row('2026_02_DET_BUF', '2026-09-17', '20:15', 'DET', 'BUF', 27, 31),
            self.row('2026_02_KC_NYJ', '2026-09-20', '13:00', 'KC', 'NYJ'),
        ]
        ticker = build_ticker(rows, d('2026-09-19'))
        self.assertEqual(ticker['week'], 2)
        self.assertIsNone(ticker['nextOpener'])
        self.assertEqual([g['id'] for g in ticker['games']], ['2026_02_DET_BUF', '2026_02_KC_NYJ', '2026_02_SF_LA'])
        self.assertEqual(ticker['games'][2]['home'], 'LAR')
        self.assertEqual([g['state'] for g in ticker['games']], ['final', 'pre', 'pre'])

    def test_offseason_has_no_games(self):
        rows = [self.row('2026_02_DET_BUF', '2026-09-17', '20:15', 'DET', 'BUF', 27, 31)]
        ticker = build_ticker(rows, d('2027-03-01'))
        self.assertEqual(ticker['games'], [])
        self.assertIsNone(ticker['week'])
        self.assertIsNone(ticker['nextOpener'])


class BuildLeadersTest(unittest.TestCase):
    def row(self, pid, name, team, week, pass_yds=0, rush_yds=0, rec_yds=0):
        return {
            'player_id': pid, 'player_display_name': name, 'team': team, 'week': week,
            'passing_yards': pass_yds, 'rushing_yards': rush_yds, 'receiving_yards': rec_yds,
        }

    def test_totals_ties_latest_team_and_rams_abbreviation(self):
        rows = [
            self.row('a', 'Matthew Stafford', 'LA', 1, pass_yds=300),
            self.row('a', 'Matthew Stafford', 'LA', 2, pass_yds=250),
            self.row('b', 'Jared Goff', 'DET', 1, pass_yds=275),
            self.row('b', 'Jared Goff', 'DET', 2, pass_yds=275),
            self.row('c', 'Joe Flacco', 'CLE', 1, pass_yds=200),
            self.row('c', 'Joe Flacco', 'CIN', 2, pass_yds=350),
            self.row('d', 'Derrick Henry', 'BAL', 2, rush_yds=None),
        ]
        leaders = build_leaders(rows, 2026)
        self.assertEqual(leaders['throughWeek'], 2)
        passing = leaders['categories'][0]['rows']
        self.assertEqual(
            [(r['rank'], r['player'], r['team'], r['value']) for r in passing],
            [(1, 'Jared Goff', 'DET', 550), (1, 'Joe Flacco', 'CIN', 550), (1, 'Matthew Stafford', 'LAR', 550)],
        )
        # Players with no yards in a category are left out of it.
        self.assertEqual(leaders['categories'][1]['rows'], [])

    def test_no_stats_yet(self):
        leaders = build_leaders([], 2026)
        self.assertEqual(leaders['throughWeek'], 0)
        self.assertTrue(all(c['rows'] == [] for c in leaders['categories']))


class PlayerSlugTest(unittest.TestCase):
    def test_periods_and_apostrophes_vanish_rather_than_splitting(self):
        self.assertEqual(player_slug('C.J. Stroud'), 'cj-stroud')
        self.assertEqual(player_slug("Ja'Marr Chase"), 'jamarr-chase')
        self.assertEqual(player_slug('Amon-Ra St. Brown'), 'amon-ra-st-brown')

    def test_accents_are_dropped(self):
        self.assertEqual(player_slug('Audric Estimé'), 'audric-estime')

    def test_slugs_match_the_typescript_helper(self):
        # src/utils/slug.ts has to produce the same strings; these are the
        # cases its own tests cover.
        self.assertEqual(player_slug('Puka Nacua'), 'puka-nacua')
        self.assertEqual(player_slug('Marvin Harrison Jr.'), 'marvin-harrison-jr')


class AgeOnTest(unittest.TestCase):
    def test_birthday_not_yet_reached_this_year(self):
        self.assertEqual(age_on(d('1983-12-02'), d('2026-09-17')), 42)

    def test_birthday_today_counts(self):
        self.assertEqual(age_on(d('1983-09-17'), d('2026-09-17')), 43)

    def test_missing_birth_date(self):
        self.assertIsNone(age_on(None, d('2026-09-17')))


class BuildRostersTest(unittest.TestCase):
    def row(self, name, team, position, **kwargs):
        row = {
            'season': 2026,
            'week': 2,
            'team': team,
            'status': 'ACT',
            'full_name': name,
            'gsis_id': f'00-{abs(hash(name)) % 10_000_000:07d}',
            'position': position,
            'depth_chart_position': position,
            'jersey_number': 1,
            'birth_date': d('2000-01-01'),
            'height': 74,
            'weight': 220,
            'college': 'Ohio State',
            'years_exp': 3,
        }
        row.update(kwargs)
        return row

    def build(self, rows):
        return build_rosters(rows, 2026, d('2026-09-17'), '2026-09-17T10:00:00Z')

    def test_only_the_latest_week_and_rostered_players_count(self):
        rosters = self.build(
            [
                self.row('Josh Allen', 'BUF', 'QB'),
                # An earlier snapshot the newest one dropped.
                self.row('Nick Broeker', 'BUF', 'G', week=1, status='DEV'),
                # Released and retired players are not on a roster.
                self.row('Mitch Trubisky', 'BUF', 'QB', status='CUT'),
                self.row('Nick Bellore', 'BUF', 'LB', status='RET'),
            ]
        )
        self.assertEqual([p['name'] for p in rosters['BUF']['players']], ['Josh Allen'])
        self.assertEqual(rosters['BUF']['week'], 2)

    def test_every_roster_status_in_the_nflverse_dictionary_is_kept(self):
        statuses = ['ACT', 'RES', 'RSN', 'PUP', 'DEV', 'E14', 'EXE', 'SUS', 'INA']
        rosters = self.build([self.row(f'Player {s}', 'BUF', 'WR', status=s) for s in statuses])
        self.assertEqual(sorted(p['status'] for p in rosters['BUF']['players']), sorted(statuses))

    def test_players_released_from_the_practice_squad_have_left(self):
        rosters = self.build(
            [self.row('Kept', 'BUF', 'WR'), self.row('Released', 'BUF', 'WR', status='TRC')]
        )
        self.assertEqual([p['name'] for p in rosters['BUF']['players']], ['Kept'])

    def test_unknown_status_codes_are_reported(self):
        rows = [self.row('A', 'BUF', 'WR'), self.row('B', 'BUF', 'WR', status='CUT'),
                self.row('C', 'BUF', 'WR', status='ZZZ')]
        self.assertEqual(unknown_statuses(rows), {'ZZZ'})

    def test_rams_use_lar_and_reserve_players_keep_a_readable_status(self):
        rosters = self.build(
            [
                self.row('Matthew Stafford', 'LA', 'QB'),
                self.row('Zech McPhearson', 'LA', 'CB', status='RES'),
                self.row('Shane Buechele', 'LA', 'QB', status='DEV'),
            ]
        )
        self.assertEqual(sorted(rosters), ['LAR'])
        labels = {p['name']: p['statusLabel'] for p in rosters['LAR']['players']}
        self.assertEqual(
            labels,
            {
                'Matthew Stafford': 'Active',
                'Zech McPhearson': 'Reserve',
                'Shane Buechele': 'Practice squad',
            },
        )

    def test_shared_names_get_their_own_slug(self):
        rosters = self.build(
            [
                self.row('Justin Jefferson', 'MIN', 'WR'),
                self.row('Justin Jefferson', 'SEA', 'LB'),
                self.row('Puka Nacua', 'LA', 'WR'),
            ]
        )
        slugs = {
            p['name'] + '/' + team: p['slug']
            for team, roster in rosters.items()
            for p in roster['players']
        }
        self.assertEqual(slugs['Justin Jefferson/MIN'], 'justin-jefferson-min')
        self.assertEqual(slugs['Justin Jefferson/SEA'], 'justin-jefferson-sea')
        # An unshared name keeps the plain slug the site derives from it.
        self.assertEqual(slugs['Puka Nacua/LAR'], 'puka-nacua')

    def test_two_players_share_a_name_on_one_team(self):
        rosters = self.build(
            [self.row('Marcus Harris', 'CHI', 'CB'), self.row('Marcus Harris', 'CHI', 'DT')]
        )
        self.assertEqual(
            sorted(p['slug'] for p in rosters['CHI']['players']),
            ['marcus-harris-chi', 'marcus-harris-chi-2'],
        )

    def test_players_are_grouped_and_ordered_like_a_depth_chart(self):
        rosters = self.build(
            [
                self.row('Bass', 'BUF', 'K', jersey_number=2),
                self.row('Cook', 'BUF', 'RB', jersey_number=4),
                self.row('Allen', 'BUF', 'QB', jersey_number=17),
                self.row('Bernard', 'BUF', 'LB', jersey_number=43),
                self.row('Coleman', 'BUF', 'WR', jersey_number=9),
                self.row('Oliver', 'BUF', 'DT', jersey_number=91),
            ]
        )
        players = rosters['BUF']['players']
        self.assertEqual(
            [(p['group'], p['position'], p['name']) for p in players],
            [
                ('offense', 'QB', 'Allen'),
                ('offense', 'RB', 'Cook'),
                ('offense', 'WR', 'Coleman'),
                ('defense', 'DT', 'Oliver'),
                ('defense', 'LB', 'Bernard'),
                ('specialists', 'K', 'Bass'),
            ],
        )
        self.assertEqual(
            rosters['BUF']['groups'],
            [
                {'key': 'offense', 'label': 'Offense'},
                {'key': 'defense', 'label': 'Defense'},
                {'key': 'specialists', 'label': 'Specialists'},
            ],
        )

    def test_specific_position_wins_and_unknown_positions_are_not_misfiled(self):
        rosters = self.build(
            [
                # The coarse position column says OL; the depth chart says G.
                self.row('Dawkins', 'BUF', 'OL', depth_chart_position='G'),
                self.row('Rookie', 'BUF', 'XX', depth_chart_position=None),
            ]
        )
        by_name = {p['name']: p for p in rosters['BUF']['players']}
        self.assertEqual((by_name['Dawkins']['position'], by_name['Dawkins']['group']), ('G', 'offense'))
        self.assertEqual((by_name['Rookie']['position'], by_name['Rookie']['group']), ('XX', 'other'))

    def test_missing_fields_stay_null_and_unnumbered_players_sort_last(self):
        rosters = self.build(
            [
                self.row('Numbered', 'BUF', 'WR', jersey_number=14),
                self.row(
                    'Unsigned',
                    'BUF',
                    'WR',
                    jersey_number=None,
                    birth_date=None,
                    height=None,
                    college=None,
                ),
            ]
        )
        players = rosters['BUF']['players']
        self.assertEqual([p['name'] for p in players], ['Numbered', 'Unsigned'])
        self.assertEqual(
            [players[1][k] for k in ('number', 'age', 'heightInches', 'college')],
            [None, None, None, None],
        )

    def test_no_rosters_published_yet(self):
        self.assertEqual(self.build([]), {})


def play(**kwargs):
    """One regular season snap. Defaults: BUF has the ball against MIA at midfield, no EPA play."""
    row = {
        'game_id': '2026_01_MIA_BUF',
        'week': 1,
        'posteam': 'BUF',
        'defteam': 'MIA',
        'down': 1,
        'yardline_100': 50,
        'pass': 0,
        'rush': 0,
        'qb_kneel': 0,
        'qb_spike': 0,
        'epa': None,
        'third_down_converted': 0,
        'third_down_failed': 0,
        'fixed_drive': 1,
        'touchdown': 0,
        'td_team': None,
    }
    row.update(kwargs)
    return row


def team_values(stats, team):
    return next(t for t in stats['teams'] if t['abbr'] == team)['values']


class BuildTeamStatsTest(unittest.TestCase):
    def build(self, rows):
        return build_team_stats(rows, 2026, '2026-09-23T10:00:00Z')

    def test_epa_and_success_count_dropbacks_and_runs_only(self):
        stats = self.build(
            [
                play(**{'pass': 1}, epa=0.6),
                play(rush=1, epa=-0.2),
                # Not counted: a kneel, a spike, a snap with no EPA, a punt.
                play(rush=1, qb_kneel=1, epa=-1.0),
                play(**{'pass': 1}, qb_spike=1, epa=-1.0),
                play(**{'pass': 1}, epa=None),
                play(epa=-3.0),
                # Extra points and two point tries have no down.
                play(down=None, **{'pass': 1}, epa=5.0),
            ]
        )
        buf, mia = team_values(stats, 'BUF'), team_values(stats, 'MIA')
        self.assertEqual(buf['off_epa'], {'value': 0.2, 'rank': 1, 'n': 2})
        self.assertEqual(buf['off_success']['value'], 0.5)
        # The same plays are MIA's defense.
        self.assertEqual(mia['def_epa']['value'], 0.2)
        self.assertEqual(mia['def_success']['n'], 2)

    def test_success_needs_positive_epa(self):
        stats = self.build([play(rush=1, epa=0.0), play(rush=1, epa=0.01)])
        self.assertEqual(team_values(stats, 'BUF')['off_success']['value'], 0.5)

    def test_third_downs_use_the_settling_play(self):
        stats = self.build(
            [
                play(down=3, third_down_converted=1),
                play(down=3, third_down_failed=1),
                play(down=3, third_down_failed=1),
                # A penalty that replays third down settles nothing.
                play(down=3),
                play(down=4, third_down_converted=1),
            ]
        )
        third = team_values(stats, 'BUF')['off_third_down']
        self.assertEqual((third['value'], third['n']), (0.333, 3))
        self.assertEqual(team_values(stats, 'MIA')['def_third_down']['value'], 0.333)

    def test_red_zone_trips_include_the_20_and_count_offensive_touchdowns(self):
        stats = self.build(
            [
                # Drive 1: reaches exactly the 20, scores.
                play(fixed_drive=1, yardline_100=35),
                play(fixed_drive=1, yardline_100=20),
                play(fixed_drive=1, yardline_100=4, touchdown=1, td_team='BUF'),
                # Drive 2: reaches the 12, field goal.
                play(fixed_drive=2, yardline_100=12),
                # Drive 3: stalls at the 21, not a trip.
                play(fixed_drive=3, yardline_100=21),
                # Drive 4: 40 yard touchdown. The extra point at the 15 has no
                # down, so this is still not a red zone trip.
                play(fixed_drive=4, yardline_100=40, touchdown=1, td_team='BUF'),
                play(fixed_drive=4, yardline_100=15, down=None),
                # Drive 5: reaches the 8, then a pick six.
                play(fixed_drive=5, yardline_100=8, touchdown=1, td_team='MIA'),
            ]
        )
        red_zone = team_values(stats, 'BUF')['off_red_zone']
        self.assertEqual((red_zone['value'], red_zone['n']), (0.333, 3))
        self.assertEqual(team_values(stats, 'MIA')['def_red_zone']['value'], 0.333)

    def test_drives_are_separate_per_game(self):
        stats = self.build(
            [
                play(game_id='2026_01_MIA_BUF', fixed_drive=1, yardline_100=10, touchdown=1, td_team='BUF'),
                play(game_id='2026_02_BUF_NYJ', week=2, defteam='NYJ', fixed_drive=1, yardline_100=10),
            ]
        )
        buf = next(t for t in stats['teams'] if t['abbr'] == 'BUF')
        self.assertEqual(buf['games'], 2)
        self.assertEqual(buf['values']['off_red_zone']['n'], 2)
        self.assertEqual(stats['throughWeek'], 2)

    def test_defense_ranks_invert_and_teams_without_a_sample_are_unranked(self):
        stats = self.build(
            [
                play(posteam='BUF', defteam='MIA', rush=1, epa=0.3),
                play(game_id='g2', posteam='KC', defteam='LA', rush=1, epa=-0.1),
                play(game_id='g2', posteam='LA', defteam='KC', rush=1, epa=0.1),
            ]
        )
        off = {t['abbr']: t['values']['off_epa']['rank'] for t in stats['teams']}
        dfn = {t['abbr']: t['values']['def_epa']['rank'] for t in stats['teams']}
        # LA is normalized to LAR. MIA never had the ball.
        self.assertEqual(off, {'BUF': 1, 'KC': 3, 'LAR': 2, 'MIA': None})
        # Allowing the least EPA ranks first.
        self.assertEqual(dfn, {'BUF': None, 'KC': 2, 'LAR': 1, 'MIA': 3})
        self.assertIsNone(team_values(stats, 'MIA')['off_epa']['value'])

    def test_metrics_carry_their_display_metadata(self):
        stats = self.build([])
        self.assertEqual(
            [(m['key'], m['side'], m['betterWhen']) for m in stats['metrics']][:1],
            [('off_epa', 'offense', 'high')],
        )
        self.assertEqual(len(stats['metrics']), 8)
        self.assertEqual((stats['teams'], stats['throughWeek']), ([], 0))


class RankTest(unittest.TestCase):
    def test_ties_share_a_rank(self):
        self.assertEqual(rank({'A': 0.5, 'B': 0.4, 'C': 0.4, 'D': 0.1}, 'high'), {'A': 1, 'B': 2, 'C': 2, 'D': 4})

    def test_low_is_better(self):
        self.assertEqual(rank({'A': 0.5, 'B': -0.2, 'C': None}, 'low'), {'A': 2, 'B': 1, 'C': None})


class PbpCacheTest(unittest.TestCase):
    now = datetime(2026, 9, 23, 10, 0, tzinfo=timezone.utc)

    def test_completed_seasons_are_kept_for_good(self):
        self.assertTrue(is_fresh(2025, 2026, self.now - timedelta(days=300), self.now))

    def test_current_season_refreshes_after_12_hours(self):
        self.assertTrue(is_fresh(2026, 2026, self.now - timedelta(hours=11), self.now))
        self.assertFalse(is_fresh(2026, 2026, self.now - timedelta(hours=13), self.now))

    def test_nothing_cached(self):
        self.assertFalse(is_fresh(2025, 2026, None, self.now))


if __name__ == '__main__':
    unittest.main()
