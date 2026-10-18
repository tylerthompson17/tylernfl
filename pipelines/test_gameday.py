"""Game day check: new finals against the committed schedule, and when to keep watching."""

import unittest
from datetime import datetime, timezone

from gameday import IDLE_WAIT, LIVE_WAIT, check

NOW = datetime(2026, 10, 18, 20, 0, tzinfo=timezone.utc)  # Sunday 4 PM Eastern


def game(id, kickoff, away=None, home=None):
    return {'id': id, 'kickoff': kickoff, 'awayScore': away, 'homeScore': home}


class GamedayTest(unittest.TestCase):
    def test_a_final_the_site_does_not_have_is_new(self):
        latest = [game('a', '2026-10-18T17:00:00Z', 20, 17), game('b', '2026-10-18T17:00:00Z', 3, 10)]
        committed = [game('a', '2026-10-18T17:00:00Z'), game('b', '2026-10-18T17:00:00Z', 3, 10)]
        new, watch, _ = check(latest, committed, NOW)
        self.assertEqual(new, ['a'])
        self.assertTrue(watch)

    def test_a_game_in_progress_is_checked_often(self):
        latest = [game('a', '2026-10-18T17:00:00Z')]
        self.assertEqual(check(latest, latest, NOW), ([], True, LIVE_WAIT))

    def test_a_kickoff_later_today_is_waited_for_slowly(self):
        latest = [game('a', '2026-10-19T00:20:00Z')]
        self.assertEqual(check(latest, latest, NOW), ([], True, IDLE_WAIT))

    def test_nothing_on_and_nothing_soon_ends_the_watch(self):
        latest = [game('done', '2026-10-18T17:00:00Z', 20, 17),
                  game('stuck', '2026-10-18T09:00:00Z'),
                  game('monday', '2026-10-20T00:15:00Z'),
                  game('tbd', None)]
        self.assertEqual(check(latest, latest, NOW), ([], False, IDLE_WAIT))


if __name__ == '__main__':
    unittest.main()
