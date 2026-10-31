import json
import shutil
import unittest
from pathlib import Path

from decisions import (
    THRESHOLD, build_decisions, coach_table, experimental_snapshot, find_decisions, grade, is_pre_snap, punter_ids,
    report, situation, summary,
)

FIXTURES = Path(__file__).resolve().parent.parent / 'tests' / 'fixtures' / 'fourth-down'
MANIFEST = Path(__file__).resolve().parent.parent / 'models' / 'fourth-down' / 'manifest.json'


def play(play_id: int, **kw) -> dict:
    """A play row with the columns decisions.py reads; a 4th and 2 at midfield
    by default, BUF at home against KC."""
    row = {
        'game_id': '2026_06_KC_BUF', 'play_id': play_id, 'season': 2026, 'week': 6, 'season_type': 'REG',
        'posteam': 'BUF', 'defteam': 'KC', 'home_team': 'BUF', 'away_team': 'KC',
        'down': 4.0, 'ydstogo': 2.0, 'yardline_100': 50.0, 'qtr': 3.0,
        'game_seconds_remaining': 1500.0, 'half_seconds_remaining': 1500.0, 'score_differential': 0.0,
        'posteam_timeouts_remaining': 3.0, 'defteam_timeouts_remaining': 3.0, 'home_opening_kickoff': 1.0,
        'roof': 'outdoors', 'temp': 60.0, 'spread_line': 0.0, 'total_line': 44.0,
        'play_type': 'run', 'desc': '(10:00) J.Cook up the middle to KC 47 for 3 yards.', 'penalty': 0,
        'penalty_type': None, 'penalty_team': None, 'timeout': 0, 'timeout_team': None,
        'qb_kneel': 0, 'qb_spike': 0, 'extra_point_attempt': 0, 'two_point_attempt': 0,
        'home_coach': 'Sean McDermott', 'away_coach': 'Andy Reid',
    }
    return row | kw


def delay(play_id: int, **kw) -> dict:
    return play(play_id, **({
        'play_type': 'no_play', 'penalty': 1, 'penalty_type': 'Delay of Game', 'penalty_team': 'BUF',
        'desc': '(10:00) (Punt formation) PENALTY on BUF, Delay of Game, 5 yards, enforced at 50 - No Play.',
    } | kw))


def timeout(play_id: int, team: str) -> dict:
    return play(play_id, play_type=None, down=None, timeout=1, timeout_team=team, desc=f'Timeout #1 by {team} at 10:00.')


class PreSnapTest(unittest.TestCase):
    def test_text_before_the_penalty(self):
        self.assertTrue(is_pre_snap({'desc': '(4:17) (Punt formation) PENALTY on BUF, Delay of Game, 5 yards - No Play.'}))
        self.assertTrue(is_pre_snap({'desc': '(3:21) (Run formation) 79-L.Borom reported in as eligible. PENALTY on DET, Delay of Game.'}))
        self.assertFalse(is_pre_snap({'desc': '(3:02) (Shotgun) 18-C.Williams pass short right. PENALTY on CHI, Offensive Holding - No Play.'}))
        self.assertFalse(is_pre_snap({'desc': '(6:42) 14-M.Araiza punts 47 yards. PENALTY on KC, Offensive Holding - No Play.'}))


class FindDecisionsTest(unittest.TestCase):
    def test_delay_of_game_then_punt_is_graded_at_the_spot_before_it(self):
        rows = [delay(10, yardline_100=50.0), play(11, play_type='punt', yardline_100=55.0, ydstogo=7.0, desc='(10:00) punts')]
        fourth, _, counts = find_decisions(rows)
        self.assertEqual(len(fourth), 1)
        d = fourth[0]
        self.assertEqual(d['row']['play_id'], 10)
        self.assertEqual(d['snap']['play_id'], 11)
        self.assertEqual(d['teamCall'], 'punt')
        self.assertEqual(d['delayOfGame'], {'playId': 10, 'yardsBack': 5})
        self.assertEqual(situation(d['row'], True)['yardline100'], 50)
        self.assertEqual(counts['delay of game, then a kick (graded at the spot before it)'], 1)
        self.assertEqual(counts['pre-snap penalties before a 4th down snap'], 1)

    def test_delay_of_game_then_go_is_graded_at_the_snap(self):
        rows = [delay(10), play(11, yardline_100=55.0, ydstogo=7.0)]
        fourth, _, counts = find_decisions(rows)
        self.assertEqual(fourth[0]['row']['play_id'], 11)
        self.assertEqual(fourth[0]['delayOfGame'], {'playId': 10, 'yardsBack': 5})
        self.assertEqual(counts['delay of game, then went for it (graded at the snap)'], 1)

    def test_a_defensive_delay_is_not_the_offense_backing_up(self):
        rows = [delay(10, penalty_team='KC'), play(11, play_type='punt', yardline_100=45.0)]
        fourth, _, _ = find_decisions(rows)
        self.assertEqual(fourth[0]['row']['play_id'], 11)
        self.assertIsNone(fourth[0]['delayOfGame'])
        self.assertEqual(fourth[0]['presnapPenalties'], ['Delay of Game'])

    def test_post_snap_penalty_is_skipped_and_the_replay_graded(self):
        nullified = play(10, play_type='no_play', penalty=1, penalty_type='Offensive Holding',
                         desc='(10:00) J.Cook up the middle for 3 yards. PENALTY on BUF, Offensive Holding - No Play.')
        fourth, _, counts = find_decisions([nullified, play(11, ydstogo=12.0, yardline_100=60.0, play_type='punt')])
        self.assertEqual([d['row']['play_id'] for d in fourth], [11])
        self.assertEqual(counts['nullified by a post-snap penalty (skipped)'], 1)

    def test_timeout_before_the_snap_and_who_called_it(self):
        fourth, _, counts = find_decisions([timeout(9, 'KC'), play(10)])
        self.assertEqual(fourth[0]['timeoutBefore'], 'defense')
        self.assertEqual(counts['snaps right after a timeout by the defense'], 1)
        fourth, _, _ = find_decisions([timeout(9, 'BUF'), play(10)])
        self.assertEqual(fourth[0]['timeoutBefore'], 'offense')
        # A timeout before an earlier down does not carry to the 4th down.
        fourth, _, _ = find_decisions([timeout(8, 'BUF'), play(9, down=3.0), play(10)])
        self.assertIsNone(fourth[0]['timeoutBefore'])

    def test_fakes_count_as_go_and_kneels_are_skipped(self):
        fake = play(10, play_type='pass', desc='(1:06) (Field Goal formation) 19-C.Johnston pass incomplete short left.')
        kneel = play(11, play_type='qb_kneel', desc='(0:40) J.Allen kneels.')
        fourth, _, counts = find_decisions([fake, kneel])
        self.assertEqual([(d['teamCall'], d['fake']) for d in fourth], [('go', True)])
        self.assertEqual(counts['fakes (counted as go)'], 1)
        self.assertEqual(counts['kneels and spikes (skipped)'], 1)

    def test_a_retaken_try_keeps_the_last_attempt(self):
        xp = play(20, down=None, play_type='no_play', extra_point_attempt=1, penalty=1, desc='extra point. PENALTY - No Play.')
        two = play(21, down=None, play_type='pass', two_point_attempt=1, desc='TWO-POINT CONVERSION ATTEMPT.')
        _, tries, counts = find_decisions([xp, two, play(22, down=None, play_type='kickoff'), play(30, down=None, play_type='extra_point', extra_point_attempt=1)])
        self.assertEqual([(t['row']['play_id'], t['teamCall']) for t in tries], [(21, 'go for 2'), (30, 'kick')])
        self.assertEqual(counts['tries retaken after a penalty (last attempt kept)'], 1)


def fourth_result(**kw) -> dict:
    base = {
        'supported': True, 'call': 'go', 'wpGo': 0.52, 'wpPunt': 0.49, 'wpFieldGoal': 0.41, 'conversionProb': 0.56,
        'fgMakeProb': 0.12, 'kickDistance': 68, 'kickerId': None, 'flags': {}, 'breakdown': {},
        'experimental': {'supported': False, 'reason': 'unavailable'},
    }
    return base | kw


class GradeTest(unittest.TestCase):
    def decision(self, call: str) -> dict:
        fourth, _, _ = find_decisions([play(10, play_type={'go': 'run', 'punt': 'punt', 'field goal': 'field_goal'}[call])])
        return fourth[0]

    def counts(self) -> dict:
        from decisions import COUNT_KEYS
        return {k: 0 for k in COUNT_KEYS}

    def test_cost_and_threshold(self):
        counts = self.counts()
        punted = grade(self.decision('punt'), fourth_result(), True, counts)
        self.assertAlmostEqual(punted['wpCost'], 0.03)
        self.assertTrue(punted['graded'])
        close = grade(self.decision('punt'), fourth_result(wpPunt=0.52 - THRESHOLD / 2), True, counts)
        self.assertFalse(close['graded'])
        agreed = grade(self.decision('go'), fourth_result(), True, counts)
        self.assertEqual((agreed['wpCost'], agreed['graded']), (0, False))
        self.assertEqual(counts['graded 4th downs'], 1)

    def test_null_option_decided_game_and_unsupported(self):
        counts = self.counts()
        kicked = grade(self.decision('field goal'), fourth_result(wpFieldGoal=None, fgMakeProb=None), True, counts)
        self.assertEqual((kicked['graded'], kicked['skip']), (False, 'null option'))
        decided = grade(self.decision('punt'), fourth_result(wpGo=0.995, wpPunt=0.99, wpFieldGoal=0.985), True, counts)
        self.assertEqual((decided['graded'], decided['skip']), (False, 'decided'))
        ot = grade(self.decision('go'), {'supported': False, 'reason': 'overtime'}, True, counts)
        self.assertEqual((ot['call'], ot['skip']), (None, 'overtime'))
        self.assertEqual(counts['overtime (not supported)'], 1)

    def test_the_coach_of_the_team_in_that_game(self):
        counts = self.counts()
        self.assertEqual(grade(self.decision('go'), fourth_result(), True, counts)['coach'], 'Sean McDermott')
        fourth, _, _ = find_decisions([play(10, posteam='KC', defteam='BUF')])
        self.assertEqual(grade(fourth[0], fourth_result(), True, counts)['coach'], 'Andy Reid')

    def test_margin_between_the_top_two(self):
        entry = grade(self.decision('punt'), fourth_result(), True, self.counts())
        self.assertAlmostEqual(entry['margin'], 0.03)

    def test_grades_never_carry_the_experimental_result(self):
        entry = grade(self.decision('punt'), fourth_result(experimental={'supported': True}), True, self.counts())
        self.assertNotIn('experimental', entry)


def experimental(week: int, **kw) -> dict:
    return {'supported': True, 'modelId': 'fd-experimental-1', 'dataAsOf': {'season': 2026, 'week': week},
            'call': 'punt', 'wpGo': 0.4812345678, **kw}


class ExperimentalSnapshotTest(unittest.TestCase):
    def test_only_tables_from_before_the_game(self):
        self.assertEqual(experimental_snapshot(fourth_result(experimental=experimental(6)), 2026, 7),
                         (experimental(6, wpGo=0.48123), 'stored this run'))
        for week in (7, 8):
            self.assertEqual(experimental_snapshot(fourth_result(experimental=experimental(week)), 2026, 7),
                             (None, 'not stored: tables not from before the game'))
        last_season = experimental(17) | {'dataAsOf': {'season': 2025, 'week': 17}}
        self.assertEqual(experimental_snapshot(fourth_result(experimental=last_season), 2026, 1)[1], 'stored this run')
        self.assertEqual(experimental_snapshot(fourth_result(), 2026, 7), (None, 'not stored: not supported'))
        self.assertEqual(experimental_snapshot({'supported': False, 'reason': 'overtime'}, 2026, 7)[1],
                         'not stored: not supported')

    def test_the_punter_who_punted_for_that_team(self):
        punt = lambda season, week, game, pid, team, gsis: {  # noqa: E731
            'season': season, 'week': week, 'game_id': game, 'play_id': pid, 'posteam': team, 'punter_player_id': gsis}
        punts = [
            punt(2025, 18, '2025_18_BUF_NYJ', 50, 'BUF', 'P-OLD'),
            punt(2026, 1, '2026_01_KC_BUF', 20, 'BUF', 'P-A'),
            punt(2026, 1, '2026_01_KC_BUF', 80, 'BUF', 'P-B'),
            punt(2026, 1, '2026_01_KC_BUF', 30, 'KC', 'P-KC'),
            punt(2026, 1, '2026_01_KC_BUF', 90, 'KC', 'P-NOESPN'),
        ]
        ids = {'P-OLD': '1', 'P-A': '2', 'P-B': '3', 'P-KC': '4'}
        punter = punter_ids(punts, ids)
        snap = lambda pid, team='BUF', game='2026_01_KC_BUF', week=1, gsis=None: {  # noqa: E731
            'season': 2026, 'week': week, 'game_id': game, 'play_id': pid, 'posteam': team, 'punter_player_id': gsis}
        self.assertEqual(punter(snap(80, gsis='P-B')), ('3', None))  # the punt itself
        self.assertEqual(punter(snap(60)), ('2', None))  # the nearest punt before it
        self.assertEqual(punter(snap(10)), ('2', None))  # none before: the first after
        self.assertEqual(punter(snap(95, team='KC')), (None, 'not stored: punter has no ESPN id'))
        # No punt in the game: the last punter of an earlier game, last season's too.
        self.assertEqual(punter(snap(10, game='2026_02_BUF_MIA', week=2)), ('3', None))
        self.assertEqual(punter(snap(10, game='2026_01_BUF_X')), ('1', None))  # same week is not earlier
        self.assertEqual(punter(snap(10, team='MIA', game='2026_02_BUF_MIA', week=2)), (None, 'not stored: no punter found'))

    def test_stored_once_and_never_replaced(self):
        rows = [play(30, play_type='punt', punter_player_id='P-A', week=6.0),
                play(10, play_type='punt', punter_player_id='P-A', week=7.0, game_id='2026_07_KC_BUF'),
                play(20, play_type='run', week=7.0, game_id='2026_07_KC_BUF')]
        def run_with(x):
            def run(requests):
                return 'nfl4th-x', [fourth_result(experimental=x) for _ in requests]
            return run

        punter = lambda snap: ('2', None) if snap['play_id'] != 20 else (None, 'not stored: no punter found')  # noqa: E731
        first = build_decisions(rows, 2026, 'now', run=run_with(experimental(6)), punter=punter)
        by_play = {e['playId']: e for e in first['fourthDowns']}
        self.assertEqual(by_play[10]['situation']['punterId'], '2')
        self.assertEqual(by_play[10]['experimental']['dataAsOf']['week'], 6)  # week 7 game, week 6 tables
        self.assertNotIn('experimental', by_play[20])  # no punter
        self.assertNotIn('experimental', by_play[30])  # week 6 game, week 6 tables
        self.assertEqual(first['experimentalCounts']['stored this run'], 1)
        self.assertEqual(first['experimentalCounts']['not stored: no punter found'], 1)
        self.assertEqual(first['experimentalCounts']['not stored: tables not from before the game'], 1)
        # A later run with new tables, or none at all, leaves the stored one.
        for later in (experimental(8, call='go'), {'supported': False, 'reason': 'season'}):
            again = build_decisions(rows, 2026, 'now', run=run_with(later), previous=first, punter=punter)
            self.assertEqual({e['playId']: e.get('experimental') for e in again['fourthDowns']},
                             {10: by_play[10]['experimental'], 20: None, 30: None})
            self.assertEqual(again['experimentalCounts']['kept from an earlier run'], 1)
        # Play 30's game has nothing stored and week 6 tables, but week 6 is
        # before the first week a pre-game result could exist: not flagged.
        self.assertEqual(first['experimentalMissed'], {'tablesAsOf': {'season': 2026, 'week': 6}, 'games': []})
        self.assertNotIn('WARNING', report(first))
        # Week 7 tables before the week 7 game was stored: flagged, week 6 still not.
        late = build_decisions(rows, 2026, 'now', run=run_with(experimental(7)), punter=punter)
        self.assertEqual(late['experimentalMissed'], {'tablesAsOf': {'season': 2026, 'week': 7},
                                                      'games': ['2026_07_KC_BUF']})
        self.assertIn('WARNING 2026_07_KC_BUF has 4th downs but no experimental results stored', report(late))
        self.assertNotIn('2026_06_KC_BUF', report(late))
        unsupported = build_decisions(rows, 2026, 'now', run=run_with({'supported': False, 'reason': 'unavailable'}),
                                      punter=punter)
        self.assertEqual(unsupported['experimentalMissed'], {'tablesAsOf': None, 'games': []})
        other_season = build_decisions(rows, 2026, 'now', run=run_with(experimental(8)), previous=first | {'season': 2025},
                                       punter=punter)
        self.assertEqual(other_season['experimentalCounts']['kept from an earlier run'], 0)


@unittest.skipUnless(shutil.which('node'), 'node is not installed')
class EngineTest(unittest.TestCase):
    def test_the_engine_through_the_pipeline_matches_the_fixtures(self):
        """A fixture's situation, turned back into a play row, goes through
        build_decisions and the Node engine to the fixture's numbers."""
        cases = json.loads((FIXTURES / 'fourth_down.json').read_text())['cases']
        case = next(c for c in cases if c['expected']['supported'] and c['expected']['wpPunt'] is not None)
        s = case['situation']
        # The week after the delivered tables, so the tables are from before the
        # game and only the missing punter keeps a result from being stored.
        as_of = json.loads(MANIFEST.read_text())['experimental']['dataAsOf']
        row = play(
            10, season=s['season'], posteam=s['posteam'], defteam=s['defteam'], home_team=s['home'],
            away_team=s['defteam'] if s['home'] == s['posteam'] else s['posteam'],
            yardline_100=float(s['yardline100']), ydstogo=float(s['distance']),
            qtr=2.0 if s['secondsRemaining'] - s['halfSecondsRemaining'] == 1800 else 4.0,
            game_seconds_remaining=float(s['secondsRemaining']), half_seconds_remaining=float(s['halfSecondsRemaining']),
            score_differential=float(s['scoreDiff']), posteam_timeouts_remaining=float(s['timeoutsOffense']),
            defteam_timeouts_remaining=float(s['timeoutsDefense']), home_opening_kickoff=1.0 if s['homeOpeningKickoff'] else 0.0,
            roof=s['roof'], spread_line=s['spreadLine'], total_line=s['totalLine'], play_type='punt',
            week=float(as_of['week'] + 1),
        )
        data = build_decisions([row], 2026, '2026-10-23T00:00:00Z')
        entry = data['fourthDowns'][0]
        expected = case['expected']
        self.assertEqual(data['modelVersion'], 'nfl4th-ecb7293')
        self.assertEqual(entry['call'], expected['call'])
        for key in ('wpGo', 'wpPunt', 'wpFieldGoal', 'conversionProb'):
            self.assertAlmostEqual(entry[key], expected[key], places=5)
        # No punter known: nothing stored, rather than today's team punter.
        self.assertNotIn('experimental', entry)
        self.assertEqual(data['experimentalCounts']['not stored: no punter found'], 1)


def entry(coach: str, team: str, cost: float, team_call='punt', call='go', margin=0.1, fourth=True, skip=None) -> dict:
    s = {'posteam': team, 'yardline100': 50} if fourth else {'posteam': team}
    return {'coach': coach, 'situation': s, 'teamCall': team_call, 'call': call, 'wpCost': cost,
            'graded': cost >= THRESHOLD and skip is None, 'skip': skip, 'margin': margin}


class LeaderboardTest(unittest.TestCase):
    def test_totals_ranked_on_their_shown_value_with_shared_ranks(self):
        rows = coach_table([
            entry('A', 'BUF', 0.05), entry('A', 'BUF', 0.01),
            entry('B', 'KC', 0.04999), entry('C', 'NE', 0.03, fourth=False, team_call='kick', call='go for 2'),
            entry('D', 'NYJ', 0.0, team_call='go'), entry('E', 'MIA', 0.9, skip='decided'),
        ])
        self.assertEqual([(r['coach'], r['rank']) for r in rows], [('A', 1), ('B', 1), ('C', 3), ('D', 4)])
        a = rows[0]
        self.assertEqual((a['decisions'], a['mistakes'], a['wpLost'], a['wpLostPerDecision']), (2, 1, 0.05, 0.025))
        self.assertEqual((rows[2]['fourthDowns'], rows[2]['tries']), (0, 1))

    def test_clear_mistakes_have_a_wide_margin(self):
        rows = coach_table([
            entry('A', 'BUF', 0.06, margin=0.06), entry('A', 'BUF', 0.03, margin=0.05),
            entry('A', 'BUF', 0.03, margin=0.0499), entry('A', 'BUF', 0.01, margin=0.2),
        ])
        self.assertEqual((rows[0]['mistakes'], rows[0]['clearMistakes']), (3, 2))

    def test_interim_coach_credited_for_his_own_games(self):
        rows = coach_table([entry('Head', 'NYG', 0.05), entry('Interim', 'NYG', 0.03)])
        self.assertEqual({r['coach']: r['teams'] for r in rows}, {'Head': ['NYG'], 'Interim': ['NYG']})

    def test_intro_numbers(self):
        fourth = [entry('A', 'BUF', 0.05, margin=0.03), entry('A', 'BUF', 0.0, team_call='go', call='go'),
                  entry('A', 'BUF', 0.03, team_call='go', call='punt', margin=0.2), entry('A', 'BUF', 0.0, call='punt')]
        tries = [entry('A', 'BUF', 0.02, fourth=False, team_call='kick', call='go for 2', margin=0.02)]
        s = summary(fourth, tries)
        self.assertEqual(s['fourthDowns'], 4)
        self.assertEqual((s['nfl4thGoShare'], s['coachGoShare']), (0.5, 0.5))
        self.assertEqual((s['mistakes'], s['kicksModelWouldGo'], s['closeCalls']), (3, 2, 2))
        self.assertAlmostEqual(s['kicksModelWouldGoShare'], 0.66667)


class RecordsFormatTest(unittest.TestCase):
    def test_one_record_a_line_and_the_same_data(self):
        from common import dumps_records

        data = {'season': 2026, 'counts': {'a': 1}, 'fourthDowns': [{'x': 1, 'y': None}, {'x': 2, 'y': 'é'}], 'tries': []}
        text = dumps_records(data)
        self.assertEqual(json.loads(text), data)
        self.assertIn('    {"x":1,"y":null},\n    {"x":2,"y":"é"}\n  ],', text)
        self.assertIn('  "tries": []\n}', text)

if __name__ == '__main__':
    unittest.main()
