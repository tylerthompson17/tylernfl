import json
import shutil
import unittest
from pathlib import Path

from decisions import THRESHOLD, build_decisions, find_decisions, grade, is_pre_snap, situation

FIXTURES = Path(__file__).resolve().parent.parent / 'tests' / 'fixtures' / 'fourth-down'


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


@unittest.skipUnless(shutil.which('node'), 'node is not installed')
class EngineTest(unittest.TestCase):
    def test_the_engine_through_the_pipeline_matches_the_fixtures(self):
        """A fixture's situation, turned back into a play row, goes through
        build_decisions and the Node engine to the fixture's numbers."""
        cases = json.loads((FIXTURES / 'fourth_down.json').read_text())['cases']
        case = next(c for c in cases if c['expected']['supported'] and c['expected']['wpPunt'] is not None)
        s = case['situation']
        row = play(
            10, season=s['season'], posteam=s['posteam'], defteam=s['defteam'], home_team=s['home'],
            away_team=s['defteam'] if s['home'] == s['posteam'] else s['posteam'],
            yardline_100=float(s['yardline100']), ydstogo=float(s['distance']),
            qtr=2.0 if s['secondsRemaining'] - s['halfSecondsRemaining'] == 1800 else 4.0,
            game_seconds_remaining=float(s['secondsRemaining']), half_seconds_remaining=float(s['halfSecondsRemaining']),
            score_differential=float(s['scoreDiff']), posteam_timeouts_remaining=float(s['timeoutsOffense']),
            defteam_timeouts_remaining=float(s['timeoutsDefense']), home_opening_kickoff=1.0 if s['homeOpeningKickoff'] else 0.0,
            roof=s['roof'], spread_line=s['spreadLine'], total_line=s['totalLine'], play_type='punt',
        )
        data = build_decisions([row], 2026, '2026-10-23T00:00:00Z')
        entry = data['fourthDowns'][0]
        expected = case['expected']
        self.assertEqual(data['modelVersion'], 'nfl4th-ecb7293')
        self.assertEqual(entry['call'], expected['call'])
        for key in ('wpGo', 'wpPunt', 'wpFieldGoal', 'conversionProb'):
            self.assertAlmostEqual(entry[key], expected[key], places=5)


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
