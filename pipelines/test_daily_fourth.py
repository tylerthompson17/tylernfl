import json
import unittest
from datetime import date, timedelta

from common import DATA_DIR
from daily_fourth import CLOSE, PLAYS, build_daily_fourth, play_summary, quarter_clock, select, spot, what_next, zone

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


def row(play_id, qtr, posteam, fixed_drive, result, drive=None, start=None, plays=0, yards=0,
        play_type='run', converted=0, home=24, away=20):
    return {'game_id': 'G', 'play_id': float(play_id), 'qtr': float(qtr), 'posteam': posteam, 'play_type': play_type,
            'fixed_drive': float(fixed_drive), 'fixed_drive_result': result,
            'drive': None if drive is None else float(drive), 'drive_play_count': float(plays), 'ydsnet': float(yards),
            'drive_start_yard_line': start, 'fourth_down_converted': float(converted),
            'home_score': home, 'away_score': away}


class WhatNextTest(unittest.TestCase):
    """Synthetic play-by-play: BUF (away) has the ball on 4th down at play 100."""

    def drives(self, fourth, *later):
        return [row(90, 1, 'KC', 0, 'Punt', 0, 'KC 25', 3, 5), fourth, *later]

    def test_a_punt_gives_the_next_possession(self):
        rows = self.drives(
            row(100, 2, 'BUF', 1, 'Punt', 1, 'BUF 25', 6, 30, 'punt'),
            row(110, 2, 'KC', 2, 'Field goal', 2, 'KC 16', 7, 46),
            row(120, 2, None, 2, 'Field goal', 2, 'KC 16', 7, 46, 'no_play'),
            row(130, 3, 'BUF', 3, 'Touchdown', 3, 'BUF 25', 9, 75),
            row(140, 4, 'BUF', 3, 'Touchdown', None, None, play_type=None),
        )
        self.assertEqual(what_next(rows, 100, 'punt'), {
            'converted': False,
            'drive': {'team': 'KC', 'startYardline100': 84, 'plays': 7, 'yards': 46, 'result': 'field goal'},
            'ended': None,
            'final': {'away': 20, 'home': 24, 'overtime': False},
        })

    def test_a_conversion_gives_the_offense_drive(self):
        rows = self.drives(
            row(100, 2, 'BUF', 1, 'Touchdown', 1, 'BUF 25', 12, 75, 'pass', converted=1),
            row(110, 2, 'KC', 2, 'Punt', 2, 'KC 25', 3, 4),
        )
        nxt = what_next(rows, 100, 'go')
        self.assertTrue(nxt['converted'])
        self.assertEqual(nxt['drive'], {'team': 'BUF', 'startYardline100': 75, 'plays': 12, 'yards': 75,
                                        'result': 'touchdown'})

    def test_a_failed_attempt_gives_the_next_possession(self):
        rows = self.drives(
            row(100, 2, 'BUF', 1, 'Turnover on downs', 1, 'BUF 25', 8, 40, 'run'),
            row(110, 2, 'KC', 2, 'Turnover', 2, 'KC 35', 2, 3),
        )
        nxt = what_next(rows, 100, 'go')
        self.assertFalse(nxt['converted'])
        self.assertEqual(nxt['drive']['team'], 'KC')
        self.assertEqual(nxt['drive']['result'], 'turnover')

    def test_a_kickoff_drive_and_split_drives_are_summed(self):
        # The NFL's own kickoff drive has no start and no plays; a fumbled
        # kickoff the kicking team recovered gives it the ball.
        rows = self.drives(
            row(100, 2, 'BUF', 1, 'Field goal', 1, 'BUF 25', 9, 50, 'field_goal'),
            row(110, 2, 'KC', 2, 'Missed field goal', 2, None, 0, 0, 'kickoff'),
            row(120, 2, 'BUF', 2, 'Missed field goal', 3, 'KC 38', 4, 2),
            row(130, 2, 'BUF', 2, 'Missed field goal', 3, 'KC 38', 4, 2),
        )
        self.assertEqual(what_next(rows, 100, 'field goal')['drive'],
                         {'team': 'BUF', 'startYardline100': 38, 'plays': 4, 'yards': 2, 'result': 'missed field goal'})

    def test_the_half_ending_first(self):
        rows = self.drives(
            row(100, 2, 'BUF', 1, 'Punt', 1, 'BUF 25', 6, 30, 'punt'),
            row(110, 3, 'KC', 2, 'Punt', 2, 'KC 25', 3, 4, 'kickoff'),
        )
        nxt = what_next(rows, 100, 'punt')
        self.assertIsNone(nxt['drive'])
        self.assertEqual(nxt['ended'], 'half')

    def test_the_game_ending_first(self):
        rows = self.drives(
            row(100, 4, 'BUF', 1, 'Punt', 1, 'BUF 25', 6, 30, 'punt'),
            row(110, 4, 'BUF', 2, 'End of half', None, None, play_type=None),
        )
        self.assertEqual(what_next(rows, 100, 'punt')['ended'], 'game')

    def test_end_of_regulation_and_overtime(self):
        rows = self.drives(
            row(100, 4, 'BUF', 1, 'Punt', 1, 'BUF 25', 6, 30, 'punt'),
            row(110, 4, 'KC', 2, 'End of half', 2, 'KC 16', 5, 61),
            row(120, 5, 'KC', 3, 'Field goal', 3, 'KC 32', 11, 55, 'kickoff'),
        )
        nxt = what_next(rows, 100, 'punt')
        self.assertEqual(nxt['drive']['result'], 'end of regulation')
        self.assertTrue(nxt['final']['overtime'])

    def test_a_return_touchdown_has_no_next_possession(self):
        rows = self.drives(
            row(100, 2, 'BUF', 1, 'Opp touchdown', 1, 'BUF 25', 6, 30, 'punt'),
            row(110, 2, 'BUF', 2, 'Punt', 2, 'BUF 25', 3, 4, 'kickoff'),
        )
        nxt = what_next(rows, 100, 'punt')
        self.assertIsNone(nxt['drive'])
        self.assertEqual(nxt['ended'], 'touchdown')

    def test_a_play_not_in_the_rows(self):
        self.assertIsNone(what_next(self.drives(row(100, 2, 'BUF', 1, 'Punt', 1, 'BUF 25', 6, 30, 'punt')), 999, 'punt'))

    def test_spots(self):
        self.assertEqual(spot('KC 16', 'KC'), 84)
        self.assertEqual(spot('KC 16', 'BUF'), 16)
        self.assertEqual(spot('LA 30', 'LAR'), 70)
        self.assertEqual(spot('50', 'KC'), 50)
        self.assertIsNone(spot(None, 'KC'))


class BackfillTest(unittest.TestCase):
    def setUp(self):
        self.decisions = real_decisions()
        self.kept = build_daily_fourth(self.decisions, DAY, None)
        self.asked: list[set[str]] = []

    def rows_for(self, ids):
        self.asked.append(ids)
        games = {}
        for p in self.kept['plays']:
            pid = int(p['key'].split(':')[1])
            games[p['gameId']] = [row(pid, 2, p['offense'], 1, 'Punt', 1, f"{p['offense']} 25", 6, 30, 'punt'),
                                  row(pid + 10, 2, p['defense'], 2, 'Touchdown', 2, f"{p['defense']} 20", 8, 80)]
        return {g: r for g, r in games.items() if g in ids}

    def test_a_kept_day_gets_only_what_happened_next(self):
        # A day written before the field existed, and a decisions file that would pick other plays now.
        old = self.kept | {'plays': [{k: v for k, v in p.items() if k != 'next'} for p in self.kept['plays']]}
        other = self.decisions | {'fourthDowns': self.decisions['fourthDowns'][100:]}
        filled = build_daily_fourth(other, DAY, old, self.rows_for)
        self.assertEqual([p['key'] for p in filled['plays']], [p['key'] for p in old['plays']])
        for before, after in zip(old['plays'], filled['plays']):
            self.assertEqual({k: v for k, v in after.items() if k != 'next'}, before)
            self.assertEqual(after['next']['drive']['result'], 'touchdown')
        self.assertEqual({k: v for k, v in filled.items() if k != 'plays'},
                         {k: v for k, v in old.items() if k != 'plays'})

    def test_a_complete_day_is_not_read_again(self):
        filled = build_daily_fourth(self.decisions, DAY, self.kept, self.rows_for)
        again = build_daily_fourth(self.decisions, DAY, filled, self.rows_for)
        self.assertIs(again, filled)
        self.assertEqual(len(self.asked), 1)

    def test_a_new_day_reads_only_its_games(self):
        game = build_daily_fourth(self.decisions, DAY + timedelta(days=1), self.kept, self.rows_for)
        self.assertEqual(self.asked, [{p['gameId'] for p in game['plays']}])
        self.assertTrue(all('next' in p for p in game['plays']))


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
