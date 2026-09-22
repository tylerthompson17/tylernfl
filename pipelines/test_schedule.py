"""schedule.json: one season's games, the Rams as LAR, lines as nflverse has them."""

import unittest

from schedule import build_schedule


def row(**fields):
    base = {'game_id': '2026_03_SEA_WAS', 'season': 2026, 'game_type': 'REG', 'week': 3,
            'gameday': '2026-09-27', 'gametime': '13:00', 'away_team': 'SEA', 'home_team': 'WAS',
            'away_score': None, 'home_score': None, 'overtime': None, 'div_game': 0, 'location': 'Home',
            'spread_line': -7.0, 'away_moneyline': -298.0, 'home_moneyline': 240.0}
    return {**base, **fields}


class ScheduleTest(unittest.TestCase):
    def test_a_game_as_the_site_reads_it(self):
        game = build_schedule([row()], 2026, 'x')['games'][0]
        self.assertEqual(game, {
            'id': '2026_03_SEA_WAS', 'week': 3, 'type': 'REG', 'kickoff': '2026-09-27T17:00:00Z',
            'away': 'SEA', 'home': 'WAS', 'awayScore': None, 'homeScore': None, 'overtime': False,
            'divisional': False, 'neutral': False, 'spreadLine': -7.0, 'awayMoneyline': -298, 'homeMoneyline': 240,
        })

    def test_one_season_in_order_with_the_rams_as_lar_and_no_preseason(self):
        rows = [
            row(game_id='b', week=2, away_team='LA', home_team='NYG', away_score=21.0, home_score=20.0, overtime=1.0),
            row(game_id='a', week=1),
            row(game_id='p', game_type='PRE'),
            row(game_id='old', season=2025),
            row(game_id='sb', game_type='SB', week=22, location='Neutral', gametime=None),
        ]
        games = build_schedule(rows, 2026, 'x')['games']
        self.assertEqual([g['id'] for g in games], ['a', 'b', 'sb'])
        self.assertEqual((games[1]['away'], games[1]['awayScore'], games[1]['overtime']), ('LAR', 21, True))
        self.assertTrue(games[2]['neutral'])
        self.assertIsNone(games[2]['kickoff'])


if __name__ == '__main__':
    unittest.main()
