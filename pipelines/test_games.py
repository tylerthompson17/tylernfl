import unittest

from games import big_plays, build_games, clock_seconds, decision_spots, line_score, player_tables, team_box


def play(play_id, **kw):
    row = {
        'game_id': '2026_01_AAA_BBB', 'season_type': 'REG', 'play_id': play_id, 'qtr': 1, 'time': '15:00',
        'game_seconds_remaining': 3600, 'home_wp': 0.5, 'home_wp_post': 0.5, 'total_away_score': 0,
        'total_home_score': 0, 'posteam': 'AAA', 'defteam': 'BBB', 'down': 1, 'play_type': 'run', 'pass': 0,
        'rush': 1, 'qb_kneel': 0, 'qb_spike': 0, 'epa': 0.1, 'yards_gained': 4, 'first_down': 0,
        'third_down_converted': 0, 'third_down_failed': 0, 'fourth_down_converted': 0, 'fourth_down_failed': 0,
        'fixed_drive': 1, 'drive': 1, 'drive_inside20': 0, 'drive_time_of_possession': '3:00', 'touchdown': 0,
        'td_team': None, 'interception': 0, 'fumble_lost': 0, 'fumbled_1_team': None, 'two_point_attempt': 0,
        'desc': '(15:00) 1-A.Runner up the middle for 4 yards.',
    }
    row.update(kw)
    return row


class LineScoreTest(unittest.TestCase):
    def test_points_per_quarter(self):
        plays = [
            play(1, qtr=1, total_away_score=7, total_home_score=0),
            play(2, qtr=2, total_away_score=7, total_home_score=3),
            play(3, qtr=3, total_away_score=7, total_home_score=3),
            play(4, qtr=4, total_away_score=14, total_home_score=10),
        ]
        self.assertEqual(line_score(plays, 14, 10), {'away': [7, 0, 0, 7], 'home': [0, 3, 0, 7]})

    def test_overtime_is_a_fifth_period(self):
        plays = [play(1, qtr=4, total_away_score=10, total_home_score=10),
                 play(2, qtr=5, total_away_score=10, total_home_score=13)]
        self.assertEqual(line_score(plays, 10, 13), {'away': [0, 0, 0, 10, 0], 'home': [0, 0, 0, 10, 3]})

    def test_none_when_it_does_not_add_up(self):
        self.assertIsNone(line_score([play(1, qtr=4, total_away_score=3)], 7, 0))


class TeamBoxTest(unittest.TestCase):
    def test_counts(self):
        plays = [
            play(1, yards_gained=10, first_down=1),
            play(2, play_type='pass', **{'pass': 1, 'rush': 0}, yards_gained=-7, epa=-1.0),  # a sack
            play(3, down=3, third_down_converted=1, drive_inside20=1, touchdown=1, td_team='AAA', yards_gained=15),
            play(4, down=None, play_type='extra_point', yards_gained=0),
            play(5, play_type='no_play', yards_gained=0, epa=None, rush=0),
            play(6, fixed_drive=2, drive=2, drive_time_of_possession='1:30', interception=1,
                 play_type='pass', **{'pass': 1, 'rush': 0}, yards_gained=0, epa=-2.0),
            play(7, posteam='BBB', defteam='AAA', fixed_drive=3, drive=3, fumble_lost=1, fumbled_1_team='AAA',
                 play_type='punt', down=4, rush=0, epa=None),
        ]
        box = team_box(plays, 'AAA')
        self.assertEqual(box['plays'], 4)
        self.assertEqual(box['yards'], 18)
        self.assertEqual((box['passYards'], box['rushYards']), (-7, 25))
        self.assertEqual(box['thirdDowns'], [1, 1])
        self.assertEqual(box['redZone'], [1, 1])
        # The interception thrown and the muffed punt AAA lost on BBB's play.
        self.assertEqual(box['turnovers'], 2)
        # Once per NFL drive: 3:00 for drive 1, 1:30 for drive 2.
        self.assertEqual(box['timeOfPossession'], 270)
        self.assertEqual(box['epaPerPlay'], round((0.1 - 1.0 + 0.1 - 2.0) / 4, 3))
        self.assertEqual(box['successRate'], 0.5)

    def test_clock(self):
        self.assertEqual(clock_seconds('01:52'), 112)
        self.assertEqual(clock_seconds('12:04'), 724)
        self.assertEqual(clock_seconds(None), 0)


class BigPlaysTest(unittest.TestCase):
    def test_largest_swings_either_way_in_game_order(self):
        plays = [play(i, home_wp=0.5, home_wp_post=0.5 + d) for i, d in
                 enumerate([0.01, -0.3, 0.2, 0.05, -0.15, 0.4, 0.0, -0.02], start=1)]
        self.assertEqual([p['playId'] for p in big_plays(plays)], [2, 3, 4, 5, 6])
        self.assertEqual(big_plays(plays)[0]['homeWpAfter'], 0.2)

    def test_a_foul_with_no_after_value_counts_and_markers_never_do(self):
        # 2026_01_ATL_PIT: pass interference on ATL has no after value; its
        # effect shows at PIT's next snap, past PIT's timeout (stale, as
        # nflverse lists them). 2026_05_NYG_WAS: the END GAME marker row
        # carries a swing of its own and is not a play.
        plays = [
            play(1042, home_wp=0.394, home_wp_post=0.363),
            play(1064, home_wp=0.363, home_wp_post=None, play_type='no_play', desc='PENALTY on ATL, DPI'),
            play(1076, home_wp=0.363, home_wp_post=None, play_type='no_play', timeout=1.0,
                 desc='Timeout #1 by PIT at 14:24.'),
            play(1105, home_wp=0.507, home_wp_post=0.490),
            play(5158, home_wp=0.5, home_wp_post=0.0, play_type=None, desc='END GAME'),
        ]
        top = big_plays(plays)
        self.assertEqual([p['playId'] for p in top], [1042, 1064, 1105])
        self.assertEqual((top[1]['homeWpBefore'], top[1]['homeWpAfter']), (0.363, 0.507))

    def test_spots_use_minutes_and_wp_before(self):
        plays = [play(10, qtr=2, game_seconds_remaining=2700, home_wp=0.61)]
        self.assertEqual(decision_spots(plays, {10, 11}), [{'playId': 10, 'x': 15.0, 'y': 0.61}])


def stat_row(pid, name, team, **kw):
    base = {c: 0 for c in ('attempts', 'carries', 'completions', 'def_fumbles_forced', 'def_interceptions',
                           'def_pass_defended', 'def_qb_hits', 'def_tackle_assists', 'def_tackles_for_loss',
                           'def_tackles_solo', 'fg_att', 'fg_made', 'passing_interceptions', 'passing_tds',
                           'passing_yards', 'pat_att', 'pat_made', 'receiving_first_downs', 'receiving_tds',
                           'receiving_yards', 'receptions', 'rushing_first_downs', 'rushing_fumbles_lost',
                           'rushing_tds', 'rushing_yards', 'sacks_suffered', 'targets')}
    base.update(def_sacks=0.0, fg_long=None, player_id=pid, player_display_name=name, team=team,
                game_id='2026_01_AAA_BBB', week=1)
    base.update(kw)
    return base


class PlayerTablesTest(unittest.TestCase):
    def test_boards_and_order(self):
        rows = [
            stat_row('1', 'A Back', 'AAA', carries=10, rushing_yards=40),
            stat_row('2', 'B Back', 'LA', carries=12, rushing_yards=80),
            stat_row('3', 'C Rusher', 'AAA', def_qb_hits=1),
            stat_row('4', 'D Tackler', 'AAA', def_tackles_solo=5, def_tackle_assists=2),
        ]
        tables = player_tables(rows)
        self.assertEqual([r[1] for r in tables['rushing']], ['B Back', 'A Back'])
        self.assertEqual(tables['rushing'][0][2], 'LAR')
        # Carries, yards, Y/A, ...: the board's columns without games played.
        self.assertEqual(tables['rushing'][0][3:6], [12, 80, 6.7])
        # A QB hit alone puts a defender in the table, behind the tackler.
        self.assertEqual([r[1] for r in tables['defense']], ['D Tackler', 'C Rusher'])
        self.assertEqual(tables['passing'], [])
        self.assertIsNone(player_tables([]))


class BuildGamesTest(unittest.TestCase):
    def test_one_file_per_final(self):
        schedule = {'game_id': '2026_01_AAA_LA', 'season': 2026, 'week': 1, 'game_type': 'REG',
                    'kickoff': '2026-09-13T17:00:00Z', 'away_team': 'AAA', 'home_team': 'LA',
                    'away_score': 7, 'home_score': 0, 'overtime': 0, 'location': 'Neutral', 'spread_line': -2.5, 'total_line': 41.0}
        plays = [play(1, game_id='2026_01_AAA_LA', defteam='LA', qtr=4, total_away_score=7)]
        record = {'gameId': '2026_01_AAA_LA', 'playId': 1, 'call': 'go', 'margin': 0.01}
        decisions = {'modelVersion': 'nfl4th-x', 'summary': {'closeMargin': 0.05},
                     'fourthDowns': [record, {'gameId': '2026_01_OTHER', 'playId': 9}], 'tries': []}
        excitement = {'games': [{'id': '2026_01_AAA_LA', 'index': 2.0, 'winnerLowWp': 0.4, 'label': None, 'score': 2.0}]}
        games = build_games([(schedule, plays)], [], decisions, excitement)
        g = games['2026_01_AAA_LA']
        self.assertEqual((g['away'], g['home'], g['spreadLine'], g['neutral']), ('AAA', 'LAR', -2.5, True))
        self.assertEqual(g['excitement'], {'index': 2.0, 'winnerLowWp': 0.4, 'label': None})
        self.assertEqual([s['playId'] for s in g['decisionSpots']], [1])
        # The game's records, copied as they are.
        self.assertEqual(g['decisions'], {'modelVersion': 'nfl4th-x', 'closeMargin': 0.05,
                                          'fourthDowns': [record], 'tries': []})
        self.assertIsNone(g['players'])

    def test_a_snapshot_is_kept_when_the_run_has_none(self):
        schedule = {'game_id': '2025_01_AAA_BBB', 'season': 2025, 'week': 1, 'game_type': 'REG',
                    'away_team': 'AAA', 'home_team': 'BBB', 'away_score': 7, 'home_score': 0}
        plays = [play(1, qtr=4, total_away_score=7)]
        snapshot = {'modelVersion': 'old', 'closeMargin': 0.05,
                    'fourthDowns': [{'gameId': '2025_01_AAA_BBB', 'playId': 1}], 'tries': []}
        g = build_games([(schedule, plays)], [], None, {'games': []}, {'2025_01_AAA_BBB': snapshot})['2025_01_AAA_BBB']
        self.assertEqual(g['decisions'], snapshot)
        self.assertEqual([s['playId'] for s in g['decisionSpots']], [1])
        self.assertIsNone(build_games([(schedule, plays)], [], None, {'games': []})['2025_01_AAA_BBB']['decisions'])

    def test_a_stored_experimental_result_is_never_replaced(self):
        schedule = {'game_id': '2026_08_AAA_BBB', 'season': 2026, 'week': 8, 'game_type': 'REG',
                    'away_team': 'AAA', 'home_team': 'BBB', 'away_score': 7, 'home_score': 0}
        plays = [play(1, game_id='2026_08_AAA_BBB', qtr=4, total_away_score=7)]
        old = {'supported': True, 'modelId': 'fd-experimental-1', 'dataAsOf': {'season': 2026, 'week': 7}}
        new = {'supported': True, 'modelId': 'fd-experimental-2', 'dataAsOf': {'season': 2026, 'week': 7}}
        record = lambda pid, **e: {'gameId': '2026_08_AAA_BBB', 'playId': pid, 'call': 'go', **e}  # noqa: E731
        snapshot = {'modelVersion': 'old', 'closeMargin': 0.05, 'tries': [],
                    'fourthDowns': [record(1, experimental=old), record(2, experimental=old), record(3)]}
        decisions = {'modelVersion': 'nfl4th-x', 'summary': {'closeMargin': 0.05}, 'tries': [],
                     'fourthDowns': [record(1), record(2, experimental=new), record(3, experimental=new), record(4)]}
        g = build_games([(schedule, plays)], [], decisions, {'games': []},
                        {'2026_08_AAA_BBB': snapshot})['2026_08_AAA_BBB']
        # Stored: kept, whatever this run has. Not stored yet: this run's, if any.
        self.assertEqual([d.get('experimental') for d in g['decisions']['fourthDowns']], [old, old, new, None])
        self.assertEqual(g['decisions']['modelVersion'], 'nfl4th-x')

if __name__ == '__main__':
    unittest.main()
