"""Tests for game excitement (excitement.py) and the ticker's labels. Run with
the other pipeline tests:
    python -m unittest discover -s pipelines
"""

import unittest

import excitement
from ticker import with_labels


def play(qtr, remaining, before, after=None):
    """A play with home win probability before the snap and after it."""
    return {'qtr': qtr, 'game_seconds_remaining': remaining, 'home_wp': before,
            'home_wp_post': before if after is None else after}


def row(away, home, away_score, home_score, week=4):
    return {'game_id': f'2026_{week:02d}_{away}_{home}', 'week': week, 'away_team': away, 'home_team': home,
            'away_score': away_score, 'home_score': home_score}


class IndexTests(unittest.TestCase):
    def test_every_change_counts_either_way(self):
        plays = [play(1, 3500, 0.5, 0.6), play(2, 2000, 0.6, 0.3), play(4, 10, 0.3, 0.9)]
        self.assertAlmostEqual(excitement.excitement_index(plays), 0.1 + 0.3 + 0.6)

    def test_a_missing_after_value_falls_back_to_before(self):
        # nflfastR leaves home_wp_post empty on a few rows.
        plays = [play(1, 3500, 0.5), play(2, 1800, 0.7)]
        self.assertAlmostEqual(excitement.excitement_index(plays), 0.2)

    def test_overtime_is_scaled_to_60_minutes(self):
        # The last play ends overtime at 5:00 left: 65 minutes played.
        plays = [play(1, 3500, 0.5, 1.0), play(5, 300, 1.0, 0.0)]
        self.assertAlmostEqual(excitement.excitement_index(plays), 1.5 * 60 / 65)

    def test_regulation_is_never_scaled_up(self):
        plays = [play(1, 3500, 0.5, 0.9), play(4, 400, 0.9, 0.95)]
        self.assertAlmostEqual(excitement.excitement_index(plays), 0.45)

    def test_no_plays_is_no_excitement(self):
        self.assertEqual(excitement.excitement_index([]), 0.0)


class LabelTests(unittest.TestCase):
    def test_comeback_comes_first(self):
        self.assertEqual(excitement.label(9.0, 0.05, 3, 70), 'Comeback')
        self.assertEqual(excitement.label(1.0, 0.10, 20, 30), 'Comeback')

    def test_thriller_before_shootout(self):
        self.assertEqual(excitement.label(6.88, 0.101, 3, 70), 'Thriller')
        self.assertEqual(excitement.label(6.87, 0.5, 3, 70), 'Shootout')

    def test_a_shootout_is_high_scoring_and_close(self):
        self.assertEqual(excitement.label(2.0, 0.4, 8, 65), 'Shootout')
        self.assertIsNone(excitement.label(2.0, 0.4, 9, 65))
        self.assertIsNone(excitement.label(2.0, 0.4, 8, 64))

    def test_a_tie_can_be_a_thriller_but_never_a_comeback(self):
        self.assertEqual(excitement.label(7.0, None, 0, 40), 'Thriller')
        self.assertIsNone(excitement.label(3.0, None, 0, 40))


class BuildTests(unittest.TestCase):
    def test_the_file(self):
        comeback = [play(1, 3500, 0.5, 0.2), play(4, 300, 0.2, 0.04), play(4, 5, 0.04, 0.99)]
        tie = [play(1, 3500, 0.5, 0.5), play(5, 0, 0.5, 0.5)]
        data = excitement.build_game_excitement(
            [(row('LA', 'SF', 20, 23), comeback), (row('NYJ', 'NE', 17, 17), tie)], 2026, '2026-09-29T10:00:00Z')

        self.assertEqual(data['season'], 2026)
        self.assertEqual(data['cutoffs'], {'comebackWp': 0.10, 'thrillerIndex': 6.88,
                                           'shootoutPoints': 65, 'shootoutMargin': 8})
        first, second = data['games']
        self.assertEqual(first, {
            'id': '2026_04_LA_SF', 'week': 4, 'away': 'LAR', 'home': 'SF',
            'index': 1.41, 'winnerLowWp': 0.04, 'score': 1.41, 'label': 'Comeback',
        })
        self.assertIsNone(second['winnerLowWp'])
        self.assertIsNone(second['label'])
        self.assertEqual(excitement.labels_by_game(data), {'2026_04_LA_SF': 'Comeback'})

    def test_the_road_winner_s_low_point(self):
        plays = [play(1, 3500, 0.5, 0.93), play(4, 60, 0.93, 0.2)]
        data = excitement.build_game_excitement([(row('BUF', 'MIA', 24, 21), plays)], 2026, '')
        self.assertEqual(data['games'][0]['winnerLowWp'], 0.07)

    def test_the_score_is_game_score(self):
        plays = [play(1, 3500, 0.5, 0.9)]
        original = excitement.GAME_SCORE
        try:
            excitement.GAME_SCORE = lambda games: {r['game_id']: 42.0 for r, _ in games}
            data = excitement.build_game_excitement([(row('BUF', 'MIA', 24, 21), plays)], 2026, '')
        finally:
            excitement.GAME_SCORE = original
        self.assertEqual(data['games'][0]['score'], 42.0)
        self.assertEqual(data['games'][0]['index'], 0.4)


class TickerLabelTests(unittest.TestCase):
    def test_labels_land_on_their_games_only(self):
        ticker = {'week': 4, 'games': [{'id': 'a', 'label': None}, {'id': 'b', 'label': None}]}
        labelled = with_labels(ticker, {'b': 'Thriller'})
        self.assertEqual([g['label'] for g in labelled['games']], [None, 'Thriller'])
        self.assertIsNone(ticker['games'][1]['label'])


if __name__ == '__main__':
    unittest.main()
