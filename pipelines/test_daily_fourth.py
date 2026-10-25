import json
import unittest
from datetime import date, timedelta

from common import DATA_DIR
from daily_fourth import CLOSE, PLAYS, build_daily_fourth, play_summary, quarter_clock, select, zone

DAY = date(2026, 10, 25)


def real_decisions() -> dict:
    return json.loads((DATA_DIR / 'decisions.json').read_text())


class SelectTest(unittest.TestCase):
    def setUp(self):
        self.decisions = real_decisions()

    def test_same_date_same_plays(self):
        a = select(self.decisions['fourthDowns'], DAY, set())
        b = select(list(reversed(self.decisions['fourthDowns'])), DAY, set())
        self.assertEqual([r['playId'] for r in a], [r['playId'] for r in b])
        self.assertEqual(len(a), PLAYS)

    def test_rules_hold_for_a_month(self):
        previous = None
        for i in range(30):
            day = DAY + timedelta(days=i)
            game = build_daily_fourth(self.decisions, day, previous)
            plays = game['plays']
            self.assertEqual(len(plays), PLAYS, day)
            self.assertLessEqual(sum(p['close'] for p in plays), 1, day)
            self.assertTrue(all(p['margin'] >= CLOSE for p in plays if not p['close']))
            self.assertGreaterEqual(sum(p['teamCall'] != p['call'] and not p['close'] for p in plays), 1, day)
            self.assertEqual(len({p['gameId'] for p in plays}), PLAYS)
            teams = [t for p in plays for t in (p['offense'], p['defense'])]
            self.assertEqual(len(set(teams)), len(teams), day)
            for call in ('go', 'punt', 'field goal'):
                self.assertLessEqual(sum(p['call'] == call for p in plays), 2, day)
            for p in plays:
                self.assertIsNotNone(p['wp'][p['call']])
                self.assertIsNotNone(p['wp'][p['teamCall']])
            previous = game

    def test_recent_plays_are_not_repeated(self):
        previous = build_daily_fourth(self.decisions, DAY, None)
        nxt = build_daily_fourth(self.decisions, DAY + timedelta(days=1), previous)
        self.assertFalse({p['key'] for p in previous['plays']} & {p['key'] for p in nxt['plays']})
        self.assertEqual(nxt['number'], 2)
        self.assertEqual([h['date'] for h in nxt['history']], ['2026-10-26', '2026-10-25'])

    def test_a_date_already_written_is_kept(self):
        previous = build_daily_fourth(self.decisions, DAY, None)
        more = self.decisions | {'fourthDowns': self.decisions['fourthDowns'][100:]}
        self.assertIs(build_daily_fourth(more, DAY, previous), previous)

    def test_too_few_plays_gives_an_empty_day(self):
        game = build_daily_fourth(self.decisions | {'fourthDowns': self.decisions['fourthDowns'][:3]}, DAY, None)
        self.assertEqual(game['plays'], [])
        self.assertEqual(game['history'], [])


class WordsTest(unittest.TestCase):
    def test_summaries(self):
        self.assertEqual(play_summary('(12:14) 16-J.Scott punts 48 yards to ARI 10.', 5, 'punt'), 'Punted 48 yards')
        self.assertEqual(play_summary('(14:55) 38-C.Ryland 54 yard field goal is No Good, Hit Right Upright.', 4,
                                      'field goal'), 'Missed a 54-yard field goal')
        self.assertEqual(play_summary('(6:54) 38-C.Ryland 27 yard field goal is GOOD.', 3, 'field goal'),
                         'Made a 27-yard field goal')
        self.assertEqual(play_summary('(2:00) (Shotgun) 10-J.Herbert sacked at ARI 13 for -10 yards (55-D.Stills).',
                                      3, 'go'), 'Stopped: sacked for a loss of 10 yards')
        self.assertEqual(play_summary('(5:01) 17-J.Allen pass short right to 13-G.Davis to KC 30 for 11 yards.', 4,
                                      'go'), 'Converted with an 11-yard pass')
        self.assertEqual(play_summary('(5:01) 28-J.Cook up the middle to KC 47 for 1 yard.', 2, 'go'),
                         'Stopped: a 1-yard run, short of the line')
        self.assertEqual(play_summary('(5:01) 17-J.Allen pass incomplete short left to 13-G.Davis.', 4, 'go'),
                         'Stopped: incomplete pass')

    def test_quarter_and_clock(self):
        self.assertEqual(quarter_clock({'secondsRemaining': 2695, 'halfSecondsRemaining': 895}), (2, 895))
        self.assertEqual(quarter_clock({'secondsRemaining': 3500, 'halfSecondsRemaining': 1700}), (1, 800))
        self.assertEqual(quarter_clock({'secondsRemaining': 1634, 'halfSecondsRemaining': 1634}), (3, 734))
        self.assertEqual(quarter_clock({'secondsRemaining': 120, 'halfSecondsRemaining': 120}), (4, 120))

    def test_zones(self):
        self.assertEqual(zone({'yardline100': 51}), 'own side')
        self.assertEqual(zone({'yardline100': 35}), 'midfield')
        self.assertEqual(zone({'yardline100': 34}), 'scoring range')


if __name__ == '__main__':
    unittest.main()
