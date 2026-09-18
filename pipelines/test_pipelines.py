"""Tests for the site data pipelines. No network or third party packages needed.

Run from the repo root:
    python -m unittest discover -s pipelines
"""

import unittest
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from common import player_slug
from leaderboards import BOARDS, build_leaderboards
from leaders import build_leaders
from pbp_cache import is_fresh
from rosters import age_on, build_rosters, unknown_statuses
from team_stats import build_team_stats, last_complete_week, rank
from transactions import build_transactions, snap_shares
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


def stat_row(player_id, name, team, week, **stats):
    """One player's week. Unlisted stats are zero, like nflverse rows."""
    from leaderboards import STAT_COLUMNS

    row = {c: 0 for c in STAT_COLUMNS}
    row.update(
        player_id=player_id,
        player_display_name=name,
        position='QB',
        team=team,
        week=week,
        game_id=f'2026_{week:02d}_{team}',
        fg_long=None,
    )
    row.update(stats)
    return row


class BuildLeaderboardsTest(unittest.TestCase):
    def board(self, rows, key):
        return build_leaderboards(rows, 2026)[key]

    def test_totals_rates_and_ranking_by_the_primary_column(self):
        rows = [
            stat_row('a', 'Josh Allen', 'BUF', 1, completions=20, attempts=30, passing_yards=280),
            stat_row('a', 'Josh Allen', 'BUF', 2, completions=25, attempts=35, passing_yards=300),
            stat_row('b', 'Jared Goff', 'DET', 1, completions=30, attempts=40, passing_yards=320),
            stat_row('b', 'Jared Goff', 'DET', 2, completions=20, attempts=30, passing_yards=260),
            stat_row('c', 'Joe Burrow', 'CIN', 1, completions=10, attempts=20, passing_yards=100),
        ]
        passing = self.board(rows, 'passing')
        self.assertEqual([(r['rank'], r['player']) for r in passing['rows']],
                         [(1, 'Jared Goff'), (1, 'Josh Allen'), (3, 'Joe Burrow')])
        allen = next(r for r in passing['rows'] if r['player'] == 'Josh Allen')
        self.assertEqual(allen['values']['games'], 2)
        self.assertEqual(allen['values']['cmp_pct'], 0.692)
        self.assertEqual(allen['values']['pass_ypa'], 8.9)
        self.assertEqual(passing['primary'], 'passing_yards')

    def test_qualifying_scales_with_team_games(self):
        rows = [
            # BUF has played 2 games: the bar is 28 attempts.
            stat_row('a', 'Josh Allen', 'BUF', 1, attempts=30),
            stat_row('a', 'Josh Allen', 'BUF', 2, attempts=30),
            stat_row('m', 'Mitch Trubisky', 'BUF', 2, attempts=20),
            # CIN has played 1 game: the bar is 14.
            stat_row('c', 'Joe Burrow', 'CIN', 1, attempts=14),
        ]
        qualified = {r['player']: (r['qualified'], r['teamGames']) for r in self.board(rows, 'passing')['rows']}
        self.assertEqual(qualified, {
            'Josh Allen': (True, 2),
            'Mitch Trubisky': (False, 2),
            'Joe Burrow': (True, 1),
        })

    def test_players_only_appear_on_boards_they_have_volume_in(self):
        rows = [stat_row('a', 'Josh Allen', 'BUF', 1, attempts=30, carries=6, rushing_yards=40)]
        boards = build_leaderboards(rows, 2026)
        self.assertEqual(len(boards['passing']['rows']), 1)
        self.assertEqual(len(boards['rushing']['rows']), 1)
        self.assertEqual(boards['receiving']['rows'], [])

    def test_rates_with_no_denominator_are_null(self):
        rows = [stat_row('r', 'Khalil Shakir', 'BUF', 1, targets=3, receptions=0)]
        receiving = self.board(rows, 'receiving')['rows'][0]['values']
        self.assertEqual((receiving['catch_pct'], receiving['rec_ypr']), (0.0, None))

    def test_bests_take_the_max_and_half_sacks_survive(self):
        rows = [
            stat_row('k', 'Tyler Bass', 'BUF', 1, fg_made=2, fg_att=2, fg_long=48),
            stat_row('k', 'Tyler Bass', 'BUF', 2, fg_made=1, fg_att=2, fg_long=None),
            stat_row('d', 'Greg Rousseau', 'BUF', 1, def_sacks=1.5),
            stat_row('d', 'Greg Rousseau', 'BUF', 2, def_sacks=0.5),
        ]
        kicking = self.board(rows, 'kicking')['rows'][0]['values']
        self.assertEqual((kicking['fg_long'], kicking['fg_pct']), (48, 0.75))
        self.assertEqual(self.board(rows, 'defense')['rows'][0]['values']['def_sacks'], 2.0)

    def test_traded_player_shows_current_team_and_rams_are_lar(self):
        rows = [
            stat_row('a', 'Davante Adams', 'LV', 1, targets=8),
            stat_row('a', 'Davante Adams', 'LA', 2, targets=9),
        ]
        self.assertEqual(self.board(rows, 'receiving')['rows'][0]['team'], 'LAR')

    def test_columns_say_which_values_divide_per_game(self):
        passing = self.board([], 'passing')
        per_game = {c['key']: c['perGame'] for c in passing['columns']}
        self.assertEqual(
            (per_game['passing_yards'], per_game['cmp_pct'], per_game['games']), (True, False, False)
        )
        longest = next(c for c in self.board([], 'kicking')['columns'] if c['key'] == 'fg_long')
        self.assertFalse(longest['perGame'])

    def test_every_board_has_a_qualifier_on_one_of_its_columns(self):
        for board in BOARDS:
            self.assertIn(board.qualifier.column, {c.key for c in board.columns}, board.key)
            self.assertIn(board.primary, {c.key for c in board.columns}, board.key)

    def test_leaders_link_to_their_board(self):
        leaders = build_leaders([], 2026)
        self.assertEqual([c['board'] for c in leaders['categories']], ['passing', 'rushing', 'receiving'])
        self.assertTrue(set(c['board'] for c in leaders['categories']) <= {b.key for b in BOARDS})


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
        'drive_inside20': 0,
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

    def test_red_zone_trips_follow_the_nflverse_drive_flag(self):
        stats = self.build(
            [
                # Drive 1: flagged inside the 20, scores.
                play(fixed_drive=1, yardline_100=35, drive_inside20=1),
                play(fixed_drive=1, yardline_100=4, drive_inside20=1, touchdown=1, td_team='BUF'),
                # Drive 2: flagged, field goal.
                play(fixed_drive=2, yardline_100=12, drive_inside20=1),
                # Drive 3: stalls exactly at the 20. nflverse does not flag it,
                # so it is not a trip.
                play(fixed_drive=3, yardline_100=20, drive_inside20=0),
                # Drive 4: 40 yard touchdown, never inside the 20.
                play(fixed_drive=4, yardline_100=40, touchdown=1, td_team='BUF'),
                play(fixed_drive=4, yardline_100=15, down=None),
                # Drive 5: flagged, then a pick six.
                play(fixed_drive=5, yardline_100=8, drive_inside20=1, touchdown=1, td_team='MIA'),
            ]
        )
        red_zone = team_values(stats, 'BUF')['off_red_zone']
        self.assertEqual((red_zone['value'], red_zone['n']), (0.333, 3))
        self.assertEqual(team_values(stats, 'MIA')['def_red_zone']['value'], 0.333)

    def test_drives_are_separate_per_game(self):
        stats = self.build(
            [
                play(game_id='2026_01_MIA_BUF', fixed_drive=1, yardline_100=10, drive_inside20=1,
                     touchdown=1, td_team='BUF'),
                play(game_id='2026_02_BUF_NYJ', week=2, defteam='NYJ', fixed_drive=1, yardline_100=10,
                     drive_inside20=1),
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


def weekly(player_id, name, week, team, status, position='WR'):
    return {
        'week': week, 'team': team, 'status': status, 'full_name': name,
        'gsis_id': player_id, 'position': position, 'depth_chart_position': position,
    }


def injury(name, team, week=2, status=None, injury='Knee', practice='Limited Participation in Practice'):
    return {
        'week': week, 'team': team, 'gsis_id': f'id-{name}', 'full_name': name, 'position': 'WR',
        'report_primary_injury': injury if status else None, 'practice_primary_injury': injury,
        'report_status': status, 'practice_status': practice,
    }


class BuildTransactionsTest(unittest.TestCase):
    def moves(self, rows):
        return build_transactions(rows, [], 2026, 2, 'now')['moves']

    def notes(self, rows):
        return {(m['player'], m['team']): m['note'] for m in self.moves(rows)}

    def test_game_day_inactives_and_practice_squad_call_ups_are_not_moves(self):
        rows = [
            weekly('a', 'Inactive Player', 1, 'BUF', 'INA'), weekly('a', 'Inactive Player', 2, 'BUF', 'ACT'),
            weekly('b', 'Kyle Van Noy', 1, 'MIN', 'ACT'), weekly('b', 'Kyle Van Noy', 2, 'MIN', 'DEV'),
            weekly('c', 'Called Up', 1, 'NYG', 'DEV'), weekly('c', 'Called Up', 2, 'NYG', 'ACT'),
            weekly('d', 'Steady', 1, 'KC', 'ACT'), weekly('d', 'Steady', 2, 'KC', 'ACT'),
        ]
        self.assertEqual(self.moves(rows), [])

    def test_signings_releases_and_reserve_placements(self):
        rows = [
            weekly('a', 'New Signing', 2, 'BUF', 'ACT'),
            weekly('b', 'Squad Signing', 2, 'BUF', 'DEV'),
            weekly('c', 'Cut Player', 1, 'BUF', 'ACT'), weekly('c', 'Cut Player', 2, 'BUF', 'CUT'),
            weekly('d', 'Squad Cut', 1, 'BUF', 'DEV'), weekly('d', 'Squad Cut', 2, 'BUF', 'CUT'),
            weekly('e', 'Hurt Player', 1, 'BUF', 'ACT'), weekly('e', 'Hurt Player', 2, 'BUF', 'RES'),
            weekly('f', 'Back Player', 1, 'BUF', 'PUP'), weekly('f', 'Back Player', 2, 'BUF', 'ACT'),
            weekly('h', 'Old Player', 1, 'BUF', 'ACT'), weekly('h', 'Old Player', 2, 'BUF', 'RET'),
        ]
        self.assertEqual(self.notes(rows), {
            ('New Signing', 'BUF'): 'Signed',
            ('Squad Signing', 'BUF'): 'Signed to practice squad',
            ('Cut Player', 'BUF'): 'Released',
            ('Squad Cut', 'BUF'): 'Released from practice squad',
            ('Hurt Player', 'BUF'): 'Placed on reserve list',
            ('Back Player', 'BUF'): 'Activated from PUP list',
            ('Old Player', 'BUF'): 'Retired',
        })

    def test_team_changes_name_the_old_team_and_rams_are_lar(self):
        rows = [
            weekly('a', 'Traded Player', 1, 'DAL', 'ACT'), weekly('a', 'Traded Player', 2, 'LA', 'ACT'),
            weekly('b', 'Claimed Player', 1, 'LA', 'DEV'), weekly('b', 'Claimed Player', 2, 'SEA', 'DEV'),
            # Cut by one team in week 1, signed by another in week 2: a signing.
            weekly('c', 'Resigned Player', 1, 'NYJ', 'CUT'), weekly('c', 'Resigned Player', 2, 'MIA', 'DEV'),
        ]
        moves = {m['player']: (m['team'], m['fromTeam'], m['note']) for m in self.moves(rows)}
        self.assertEqual(moves, {
            'Traded Player': ('LAR', 'DAL', 'Joined from DAL'),
            'Claimed Player': ('SEA', 'LAR', 'Joined practice squad from LAR'),
            'Resigned Player': ('MIA', None, 'Signed to practice squad'),
        })

    def test_missing_from_a_snapshot_is_not_leaving(self):
        # In 2025, 97% of players who vanished from a week came back on the
        # same team; most were byes.
        rows = [
            weekly('a', 'Reserve Player', 1, 'BUF', 'RES'),
            weekly('b', 'Anyone', 1, 'KC', 'ACT'), weekly('b', 'Anyone', 2, 'KC', 'ACT'),
        ]
        self.assertEqual(self.moves(rows), [])

    def test_a_bye_week_does_not_turn_a_roster_into_signings(self):
        rows = [
            # BUF is on bye in week 2: no snapshot. Week 3 compares with week 1.
            weekly('a', 'Josh Allen', 1, 'BUF', 'ACT'), weekly('a', 'Josh Allen', 3, 'BUF', 'ACT'),
            weekly('b', 'Hurt Player', 1, 'BUF', 'ACT'), weekly('b', 'Hurt Player', 3, 'BUF', 'RES'),
            weekly('c', 'Other Team', 2, 'KC', 'ACT'), weekly('c', 'Other Team', 3, 'KC', 'ACT'),
        ]
        data = build_transactions(rows, [], 2026, 3, 'now')
        self.assertEqual([(m['player'], m['note']) for m in data['moves']], [('Hurt Player', 'Placed on reserve list')])
        self.assertEqual((data['movesWeek'], data['comparedToWeek']), (3, 2))

    def test_players_already_gone_stay_quiet_and_unknown_statuses_are_skipped(self):
        rows = [
            weekly('a', 'Long Gone', 1, 'BUF', 'CUT'),
            weekly('b', 'Still Retired', 1, 'BUF', 'RET'), weekly('b', 'Still Retired', 2, 'BUF', 'RET'),
            weekly('c', 'Odd Code', 1, 'BUF', 'ACT'), weekly('c', 'Odd Code', 2, 'BUF', 'ZZZ'),
        ]
        self.assertEqual(self.moves(rows), [])

    def test_bigger_news_sorts_first_and_practice_squad_churn_last(self):
        rows = [
            weekly('a', 'Squad Signing', 2, 'ARI', 'DEV'),
            weekly('b', 'Cut Player', 1, 'ARI', 'ACT'), weekly('b', 'Cut Player', 2, 'ARI', 'CUT'),
            weekly('c', 'Hurt Player', 1, 'WAS', 'ACT'), weekly('c', 'Hurt Player', 2, 'WAS', 'RES'),
        ]
        self.assertEqual([m['player'] for m in self.moves(rows)], ['Hurt Player', 'Cut Player', 'Squad Signing'])

    def test_snap_share_uses_the_last_8_games_across_seasons(self):
        rows = [{'season': 2025, 'week': w, 'pfr_player_id': 'AllenJo', 'offense_pct': 0.0, 'defense_pct': 0.0}
                for w in range(1, 11)]
        rows += [{'season': 2025, 'week': w, 'pfr_player_id': 'AllenJo', 'offense_pct': 1.0, 'defense_pct': 0.0}
                 for w in range(11, 18)]
        rows += [{'season': 2026, 'week': 1, 'pfr_player_id': 'AllenJo', 'offense_pct': 0.5, 'defense_pct': None},
                 {'season': 2026, 'week': 1, 'pfr_player_id': 'Unknown', 'offense_pct': 1.0, 'defense_pct': 0.0}]
        # Last 8 games: seven at 100% and one at 50%. Older benchings drop out.
        self.assertEqual(snap_shares(rows, {'AllenJo': 'g-allen'}), {'g-allen': 0.9375})

    def test_items_get_categories_and_starters_rank_first(self):
        rows = [
            weekly('a', 'Depth Player', 1, 'ARI', 'ACT'), weekly('a', 'Depth Player', 2, 'ARI', 'RES'),
            weekly('b', 'Star Player', 1, 'WAS', 'ACT'), weekly('b', 'Star Player', 2, 'WAS', 'RES'),
            weekly('c', 'Squad Player', 2, 'ARI', 'DEV'),
            weekly('d', 'Back Player', 1, 'KC', 'RES'), weekly('d', 'Back Player', 2, 'KC', 'ACT'),
        ]
        injuries = [injury('Star Out', 'DET', status='Out'), injury('Star Practicing', 'KC')]
        shares = {'b': 0.9, 'a': 0.2, 'id-Star Out': 1.0, 'id-Star Practicing': 0.99}
        data = build_transactions(rows, injuries, 2026, 2, 'now', shares)
        items = sorted(data['moves'] + data['injuries'], key=lambda i: i['priority'])
        self.assertEqual(
            [(i['player'], i['category'], i['snapShare']) for i in items],
            [
                ('Star Out', 'game-status', 1.0),
                ('Star Player', 'reserve', 0.9),
                ('Depth Player', 'reserve', 0.2),
                ('Back Player', 'activated', None),
                # Routine items: below all news, starters first.
                ('Star Practicing', 'practice-report', 0.99),
                ('Squad Player', 'practice-squad', None),
            ],
        )
        self.assertEqual([i['starter'] for i in items], [True, True, False, False, True, False])
        self.assertEqual(data['categories'][0], {'key': 'game-status', 'label': 'Game status'})

    def test_a_starter_at_full_practice_never_outranks_a_game_status(self):
        injuries = [injury('Starter Full', 'BUF', practice='Full Participation in Practice'),
                    injury('Backup Questionable', 'BUF', status='Questionable'),
                    injury('Starter Out Of Practice', 'BUF', practice='Did Not Participate In Practice')]
        shares = {'id-Starter Full': 0.9, 'id-Backup Questionable': 0.3, 'id-Starter Out Of Practice': 0.9}
        data = build_transactions([], injuries, 2026, 2, 'now', shares)
        self.assertEqual(
            [i['player'] for i in sorted(data['injuries'], key=lambda i: i['priority'])],
            ['Backup Questionable', 'Starter Out Of Practice', 'Starter Full'],
        )

    def test_statuses_for_a_game_already_played_drop_below_the_news(self):
        rows = [weekly('a', 'Backup Cut', 1, 'KC', 'ACT'), weekly('a', 'Backup Cut', 2, 'KC', 'CUT')]
        injuries = [injury('Played Out', 'DET', status='Out'), injury('Upcoming Q', 'KC', status='Questionable')]
        shares = {'id-Played Out': 1.0, 'id-Upcoming Q': 0.2}
        data = build_transactions(rows, injuries, 2026, 2, 'now', shares, played_teams={'DET', 'BUF'})
        items = sorted(data['moves'] + data['injuries'], key=lambda i: i['priority'])
        # A starter ruled out of last night's game now trails a backup's release.
        self.assertEqual([i['player'] for i in items], ['Upcoming Q', 'Backup Cut', 'Played Out'])
        self.assertEqual({i['player']: i['gamePlayed'] for i in data['injuries']},
                         {'Played Out': True, 'Upcoming Q': False})
        self.assertEqual(items[-1]['category'], 'game-status')

    def test_game_statuses_rank_out_then_doubtful_then_questionable(self):
        injuries = [injury('Q', 'BUF', status='Questionable'), injury('D', 'BUF', status='Doubtful'),
                    injury('O', 'BUF', status='Out')]
        data = build_transactions([], injuries, 2026, 2, 'now', {})
        self.assertEqual([i['player'] for i in sorted(data['injuries'], key=lambda i: i['priority'])], ['O', 'D', 'Q'])

    def test_first_week_has_nothing_to_compare(self):
        data = build_transactions([weekly('a', 'Anyone', 1, 'BUF', 'ACT')], [], 2026, 1, 'now')
        self.assertEqual((data['movesWeek'], data['comparedToWeek'], data['moves']), (1, None, []))

    def test_offseason_is_empty(self):
        rows = [weekly('a', 'Anyone', 2, 'BUF', 'ACT')]
        data = build_transactions(rows, [injury('X', 'BUF')], 2026, None, 'now')
        self.assertEqual((data['week'], data['moves'], data['injuries']), (None, [], []))

    def test_injury_report_for_the_ticker_week_sorted_by_game_status(self):
        rows = [
            injury('Practice Only', 'BUF'),
            injury('Questionable Player', 'BUF', status='Questionable'),
            injury('Out Player', 'LA', status='Out', injury='Hip', practice='Did Not Participate In Practice'),
            injury('Last Week', 'BUF', week=1, status='Out'),
        ]
        injuries = build_transactions([], rows, 2026, 2, 'now')['injuries']
        self.assertEqual(
            [(i['player'], i['team'], i['status'], i['injury'], i['practice']) for i in injuries],
            [
                ('Out Player', 'LAR', 'Out', 'Hip', 'Did not practice'),
                ('Questionable Player', 'BUF', 'Questionable', 'Knee', 'Limited'),
                ('Practice Only', 'BUF', None, 'Knee', 'Limited'),
            ],
        )


class LastCompleteWeekTest(unittest.TestCase):
    def game(self, week, final=True, game_type='REG'):
        score = 20 if final else None
        return {'game_type': game_type, 'week': week, 'away_score': score, 'home_score': score}

    def test_a_week_counts_once_every_game_is_final(self):
        # Thursday of week 2: one game played, fifteen to go.
        rows = [self.game(1), self.game(1), self.game(2), self.game(2, final=False)]
        self.assertEqual(last_complete_week(rows), 1)
        self.assertEqual(last_complete_week(rows[:3]), 2)

    def test_nothing_played_and_preseason_games(self):
        self.assertEqual(last_complete_week([self.game(1, final=False)]), 0)
        self.assertEqual(last_complete_week([self.game(1, game_type='PRE')]), 0)

    def test_a_gap_stops_the_count(self):
        self.assertEqual(last_complete_week([self.game(1), self.game(3)]), 1)


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
