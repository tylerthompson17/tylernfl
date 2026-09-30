"""Tests for the notable performances reference file (performance_percentiles.py).
Run with the other pipeline tests:
    python -m unittest discover -s pipelines
"""

import unittest
from datetime import date

from performance_percentiles import build_performance_percentiles, last_completed_season, team_leader_counts


def row(team, week=1, season=2024, **stats):
    base = {'season': season, 'week': week, 'team': team, 'passing_yards': 0, 'rushing_yards': 0,
            'receiving_yards': 0, 'def_sacks': 0, 'fg_made': 0, 'fg_att': 0}
    return {**base, **stats}


class TeamLeaderTests(unittest.TestCase):
    def test_each_team_game_counts_once_at_its_best(self):
        rows = [row('BUF', passing_yards=300), row('BUF', passing_yards=12), row('BUF', rushing_yards=80),
                row('BUF', rushing_yards=45), row('KC', passing_yards=300), row('KC', week=2, passing_yards=250)]
        counts = team_leader_counts(rows)
        self.assertEqual(counts['passing'], {300.0: 2, 250.0: 1})
        self.assertEqual(counts['rushing'], {80.0: 1, 0.0: 2})

    def test_a_team_game_with_no_sacks_counts_as_zero(self):
        counts = team_leader_counts([row('BUF', def_sacks=1.5), row('BUF', def_sacks=0.5), row('KC')])
        self.assertEqual(counts['defense'], {1.5: 1, 0.0: 1})

    def test_a_row_with_no_team_is_left_out(self):
        counts = team_leader_counts([row(None, passing_yards=40), row('BUF', passing_yards=250)])
        self.assertEqual(counts['passing'], {250.0: 1})

    def test_field_goals_count_only_games_with_an_attempt(self):
        counts = team_leader_counts([row('BUF', fg_made=0, fg_att=2), row('KC', fg_made=0, fg_att=0),
                                     row('MIA', fg_made=4, fg_att=5)])
        self.assertEqual(counts['kicking'], {0.0: 1, 4.0: 1})

    def test_the_file(self):
        data = build_performance_percentiles([row('BUF', def_sacks=2.5, passing_yards=301)], 2025)
        self.assertEqual((data['fromSeason'], data['throughSeason']), (1999, 2025))
        self.assertEqual(data['categories']['defense'], {'stat': 'def_sacks', 'games': 1, 'values': [[2.5, 1]]})
        # Whole numbers stay whole, so yards read as 301.
        self.assertEqual(data['categories']['passing']['values'], [[301, 1]])
        self.assertIsInstance(data['categories']['passing']['values'][0][0], int)
        self.assertEqual(data['categories']['kicking'], {'stat': 'fg_made', 'games': 0, 'values': []})


class SeasonTests(unittest.TestCase):
    def test_a_season_is_complete_from_march(self):
        self.assertEqual(last_completed_season(date(2026, 9, 29)), 2025)
        self.assertEqual(last_completed_season(date(2027, 2, 14)), 2025)
        self.assertEqual(last_completed_season(date(2027, 3, 1)), 2026)


if __name__ == '__main__':
    unittest.main()
