"""Playoff odds: the moneyline arithmetic, and the simulator checked against
a season whose outcome is known."""

import json
import unittest
from pathlib import Path

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


FROZEN = Path(__file__).resolve().parent.parent / 'tests' / 'fixtures' / 'playoff_odds' / '2023_week10.json'


def frozen_input() -> list[dict]:
    """2023 after week 10, week 11 priced (home -150, away +130), the rest
    unpriced. FROZEN is what build_playoff_odds gave for it, n=2000, before
    the draft projection was added to the simulation, written as the daily
    run writes it."""
    rows = schedule_rows(2023)
    for r in rows:
        if r['week'] > 10:
            r['away_score'] = r['home_score'] = None
        r['home_moneyline'], r['away_moneyline'] = (-150, 130) if r['week'] == 11 else (None, None)
    return rows


def frozen_text(odds: dict) -> str:
    return json.dumps(odds, indent=2, ensure_ascii=False) + '\n'


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


def season_2025(playoffs_through: str | None = 'SB') -> list[dict]:
    """The draft fixture's 2025 season in the schedule's shape, playoff
    games after `playoffs_through` left unplayed (None: all of them)."""
    import test_draft_order
    played = PLAYOFF_ORDER[:PLAYOFF_ORDER.index(playoffs_through) + 1] if playoffs_through else ()
    rows = []
    for g in test_draft_order.GAMES:
        r = {**g, 'game_id': f"2025_{g['week']:02d}_{g['away_team']}_{g['home_team']}",
             'home_moneyline': None, 'away_moneyline': None}
        if r['game_type'] != 'REG' and r['game_type'] not in played:
            r['away_score'] = r['home_score'] = None
        rows.append(r)
    return rows


PLAYOFF_ORDER = ['WC', 'DIV', 'CON', 'SB']


def project(rows: list[dict], n: int, picks: dict | None = None) -> tuple[dict, dict]:
    projection = playoff_odds.DraftProjection(picks or {'picks': [], 'choices': []}, list(fixtures.ALIGNMENT))
    odds = playoff_odds.build_playoff_odds(rows, 2025, 'x', alignment=fixtures.ALIGNMENT, n=n, draft=projection)
    return odds, projection.result(odds)


class OddsUnchangedTests(unittest.TestCase):
    """The draft projection draws from its own random stream, so the odds
    are exactly what the simulator gave before it existed."""

    def test_playoff_odds_are_byte_identical_with_and_without_the_draft(self):
        expected = FROZEN.read_text(encoding='utf-8')
        plain = playoff_odds.build_playoff_odds(frozen_input(), 2023, '2026-10-22T00:00:00Z',
                                                alignment=fixtures.ALIGNMENT, n=2000)
        self.assertEqual(frozen_text(plain), expected)
        projection = playoff_odds.DraftProjection({'picks': [], 'choices': []}, list(fixtures.ALIGNMENT))
        with_draft = playoff_odds.build_playoff_odds(frozen_input(), 2023, '2026-10-22T00:00:00Z',
                                                     alignment=fixtures.ALIGNMENT, n=2000, draft=projection)
        self.assertEqual(frozen_text(with_draft), expected)
        self.assertEqual(projection.n, 2000)


class DraftProjectionTests(unittest.TestCase):
    def test_a_finished_season_projects_the_leagues_order_for_certain(self):
        import test_draft_order
        expected = test_draft_order.EXPECTED['order']
        _, projected = project(season_2025(), 20)
        for t in projected['teams']:
            pick = expected.index(t['team']) + 1
            self.assertEqual(t['slots'][pick - 1], 1.0, t['team'])
            self.assertEqual((t['medianPick'], t['range']), (pick, [pick, pick]), t['team'])
        self.assertEqual([t['team'] for t in projected['teams']], expected)

    def test_before_the_playoffs_the_first_18_are_certain_and_the_rest_by_round(self):
        import test_draft_order
        expected = test_draft_order.EXPECTED['order']
        _, projected = project(season_2025(None), 2000)
        by_team = {t['team']: t for t in projected['teams']}
        for pick, team in enumerate(expected[:18], 1):
            self.assertEqual(by_team[team]['slots'][pick - 1], 1.0, team)
        for team in expected[18:]:
            self.assertEqual(sum(by_team[team]['slots'][:18]), 0.0, team)
        # Every playoff game even: a top seed (a bye) is champion one time
        # in 8, everyone else one in 16.
        for team in ('DEN', 'SEA'):
            self.assertAlmostEqual(by_team[team]['slots'][31], 1 / 8, delta=0.025, msg=team)
        for team in ('JAX', 'BUF', 'CAR', 'GB'):
            self.assertAlmostEqual(by_team[team]['slots'][31], 1 / 16, delta=0.02, msg=team)
        self.assertEqual(projected['pricedPlayoffGames'], 0)

    def test_played_playoff_games_are_kept(self):
        # After the wild card round its six losers can only pick 19 to 24.
        _, projected = project(season_2025('WC'), 500)
        losers = {'CAR', 'GB', 'PIT', 'LAC', 'PHI', 'JAX'}
        for t in projected['teams']:
            in_19_to_24 = sum(t['slots'][18:24])
            self.assertAlmostEqual(in_19_to_24, 1.0 if t['team'] in losers else 0.0, places=2, msg=t['team'])

    def test_ties_left_are_drawn_at_random_in_each_season(self):
        # Week 1 only, nothing left to play: 16 teams at 0-1 level on
        # everything, so picks 1 to 16 are a fresh draw every time.
        rows = [r for r in season_2025() if r['game_type'] == 'REG' and r['week'] == 1]
        _, projected = project(rows, 1500)
        losers = [t for t in projected['teams'] if t['meanWins'] == 0]
        self.assertEqual(len(losers), 16)
        for t in losers:
            self.assertAlmostEqual(t['first'], 1 / 16, delta=0.025, msg=t['team'])

    def test_a_choice_counts_how_often_each_pick_goes_over(self):
        picks = {'picks': [{'draft': 2026, 'original': 'GB', 'owner': 'DAL', 'status': 'traded'}],
                 'choices': [{'between': ['DAL', 'GB'], 'takes': 'earlier', 'from': 'DAL', 'to': 'NYJ'}]}
        _, projected = project(season_2025(), 20, picks)
        # 2025: Dallas picked 12th, Green Bay 20th.
        self.assertEqual(projected['choices'][0]['chances'], {'DAL': 1.0, 'GB': 0.0})
        owners = {t['team']: t['owner'] for t in projected['teams']}
        self.assertEqual((owners['DAL'], owners['GB'], owners['LV']), (None, None, 'LV'))

    def test_a_rerun_with_the_same_inputs_is_identical(self):
        rows = season_2025(None)
        self.assertEqual(project(rows, 300)[1], project(rows, 300)[1])
