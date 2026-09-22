"""Playoff odds: the moneyline arithmetic, and the simulator checked against
a season whose outcome is known."""

import unittest

import playoff_odds
import test_standings as fixtures


def schedule_rows(season: int) -> list[dict]:
    """The nflseedR fixture games in the nflverse schedule's shape."""
    return [
        {'game_id': f"{season}_{g['week']:02d}_{g['away_team']}_{g['home_team']}", 'season': season,
         'game_type': 'REG', 'week': g['week'], 'away_team': g['away_team'], 'home_team': g['home_team'],
         'away_score': g['away_score'], 'home_score': g['home_score']}
        for g in fixtures.GAMES[season]
    ]


class MoneylineTests(unittest.TestCase):
    def test_american_odds_to_implied_probability(self):
        self.assertAlmostEqual(playoff_odds.implied(-298), 298 / 398)
        self.assertAlmostEqual(playoff_odds.implied(240), 100 / 340)
        self.assertAlmostEqual(playoff_odds.implied(100), 0.5)

    def test_the_margin_comes_out_so_the_two_sides_sum_to_one(self):
        game = {'game_id': 'g', 'home_moneyline': 240, 'away_moneyline': -298}
        p_home = playoff_odds.betting_lines([game])['g']
        h, a = 100 / 340, 298 / 398
        self.assertAlmostEqual(p_home, h / (h + a))
        self.assertLess(p_home, 0.5)

    def test_a_game_without_a_line_is_even(self):
        games = [{'game_id': 'g', 'home_moneyline': None, 'away_moneyline': None}]
        self.assertEqual(playoff_odds.betting_lines(games), {'g': 0.5})
        self.assertEqual(playoff_odds.priced(games), 0)


class KnownSeasonTests(unittest.TestCase):
    """2024 from week 12 on, with every remaining game given its real result
    for certain: every chance must be 0 or 1 and match how it finished."""

    def setUp(self):
        rows = schedule_rows(2024)
        for r in rows:
            if r['week'] > 12:
                r['result_home_won'] = r['home_score'] > r['away_score']
                r['away_score'] = r['home_score'] = None
        known = {r['game_id']: (1.0 if r.pop('result_home_won') else 0.0) for r in rows if 'result_home_won' in r}
        self.odds = playoff_odds.build_playoff_odds(
            rows, 2024, 'x', alignment=fixtures.ALIGNMENT, n=20, game_probabilities=lambda games: known,
        )
        self.final = fixtures.EXPECTED[(2024, 18)]

    def test_every_chance_is_certain(self):
        for t in self.odds['teams']:
            for key in ('playoffs', 'division', 'topSeed'):
                self.assertIn(t[key], (0.0, 1.0), f"{t['team']} {key}")

    def test_the_real_final_seeding_comes_out(self):
        for t in self.odds['teams']:
            real = self.final[t['team']]
            seed = int(real['conf_rank'])
            with self.subTest(team=t['team']):
                self.assertEqual(t['playoffs'], 1.0 if seed <= 7 else 0.0)
                self.assertEqual(t['division'], 1.0 if int(real['div_rank']) == 1 else 0.0)
                self.assertEqual(t['topSeed'], 1.0 if seed == 1 else 0.0)
                expected_seeds = [1.0 if seed == i + 1 else 0.0 for i in range(7)]
                self.assertEqual(t['seeds'], expected_seeds)
                self.assertEqual(t['meanWins'], float(real['wins']))

    def test_what_it_says_about_itself(self):
        self.assertEqual(self.odds['throughWeek'], 12)
        self.assertEqual(self.odds['remainingGames'], sum(1 for g in fixtures.GAMES[2024] if g['week'] > 12))
        self.assertEqual(self.odds['source'], 'betting lines')


class ChanceTests(unittest.TestCase):
    def build(self, n=200, week=16, lines=None):
        rows = schedule_rows(2024)
        for r in rows:
            if r['week'] > week:
                r['away_score'] = r['home_score'] = None
                r['home_moneyline'], r['away_moneyline'] = lines if lines else (None, None)
        return playoff_odds.build_playoff_odds(rows, 2024, 'x', alignment=fixtures.ALIGNMENT, n=n)

    def test_a_rerun_with_the_same_inputs_is_identical(self):
        self.assertEqual(self.build(), self.build())

    def test_seeds_add_up_to_the_playoff_chance_and_each_conference_fills_seven(self):
        odds = self.build()
        for t in odds['teams']:
            self.assertAlmostEqual(sum(t['seeds']), t['playoffs'], places=2)
        for conf in ('AFC', 'NFC'):
            teams = [t for t in odds['teams'] if fixtures.ALIGNMENT[t['team']][0] == conf]
            self.assertAlmostEqual(sum(t['playoffs'] for t in teams), 7, places=1)
            self.assertAlmostEqual(sum(t['division'] for t in teams), 4, places=1)

    def test_unpriced_games_are_counted(self):
        odds = self.build()
        self.assertEqual(odds['pricedGames'], 0)
        self.assertGreater(odds['remainingGames'], 0)



class BeforeTheSeasonTests(unittest.TestCase):
    def test_nothing_is_simulated_before_the_first_game(self):
        rows = schedule_rows(2024)
        for r in rows:
            r['away_score'] = r['home_score'] = None
        odds = playoff_odds.build_playoff_odds(rows, 2024, 'x', alignment=fixtures.ALIGNMENT, n=50)
        self.assertEqual((odds['teams'], odds['simulations'], odds['remainingGames']), ([], 0, 272))


if __name__ == '__main__':
    unittest.main()
