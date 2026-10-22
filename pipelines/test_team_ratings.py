"""Team ratings: the fit recovers ratings that made the lines, and the
pricing keeps lines, prices the rest and drops home field at neutral sites."""

import math
import random
import unittest
from datetime import date, timedelta

import playoff_odds
import team_ratings as tr
import test_standings as fixtures

TEAMS = sorted({tr.franchise(t) for t in fixtures.ALIGNMENT})
TRUE = {t: (i - 15.5) / 20 for i, t in enumerate(TEAMS)}  # -0.775 to 0.775
HOME = 0.25


def american(p: float) -> float:
    """The moneyline for a fair chance p, so the no-vig chance is p again."""
    return -100 * p / (1 - p) if p >= 0.5 else 100 * (1 - p) / p


def priced_season(through_week: int, lines_through: int, ratings=TRUE, season=2024) -> list[dict]:
    """The 2024 fixture games with gamedays, lines from `ratings` through
    `lines_through`, and scores through `through_week`."""
    rows = []
    for g in fixtures.GAMES[2024]:
        p = tr.logistic(ratings[tr.franchise(g['home_team'])] - ratings[tr.franchise(g['away_team'])] + HOME)
        lined = g['week'] <= lines_through
        played = g['week'] <= through_week
        rows.append({
            'game_id': f"{season}_{g['week']:02d}_{g['away_team']}_{g['home_team']}", 'season': season,
            'game_type': 'REG', 'week': g['week'],
            'gameday': (date(season, 9, 5) + timedelta(weeks=g['week'] - 1)).isoformat(),
            'away_team': g['away_team'], 'home_team': g['home_team'], 'location': 'Home',
            'away_score': g['away_score'] if played else None, 'home_score': g['home_score'] if played else None,
            'home_moneyline': american(p) if lined else None, 'away_moneyline': american(1 - p) if lined else None,
        })
    return rows



class FitTests(unittest.TestCase):
    def test_exact_lines_give_back_the_ratings_and_home_field(self):
        rows = priced_season(18, 18)
        ratings, home = tr.fit(rows, TEAMS, date(2025, 1, 5), None, penalty=1e-6)
        self.assertAlmostEqual(home, HOME, places=4)
        for t in TEAMS:
            self.assertAlmostEqual(ratings[t], TRUE[t], places=4, msg=t)

    def test_ratings_sum_to_zero(self):
        prior = {t: 0.3 * (i % 5) for i, t in enumerate(TEAMS)}  # does not sum to zero
        for rows in (priced_season(3, 4), []):
            ratings, _ = tr.fit(rows, TEAMS, date(2024, 9, 26), prior)
            self.assertAlmostEqual(sum(ratings.values()), 0, places=9)

    def test_with_no_lines_the_ratings_are_last_seasons_times_the_carryover(self):
        prior = {t: TRUE[t] for t in TEAMS}
        ratings, home = tr.fit([], TEAMS, None, prior, carryover=0.7)
        for t in TEAMS:
            self.assertAlmostEqual(ratings[t], 0.7 * TRUE[t], msg=t)
        self.assertEqual(home, 0.0)

    def test_the_penalty_pulls_toward_the_prior_not_home_field(self):
        rows = priced_season(1, 1)
        prior = {t: -TRUE[t] for t in TEAMS}
        loose, home_loose = tr.fit(rows, TEAMS, date(2024, 9, 8), prior, penalty=0.01)
        tight, home_tight = tr.fit(rows, TEAMS, date(2024, 9, 8), prior, penalty=100)
        team = TEAMS[-1]
        self.assertGreater(loose[team], tight[team])
        self.assertAlmostEqual(tight[team], -0.7 * TRUE[team], delta=0.02)
        # Home field is not penalized, so it still comes from the lines.
        self.assertGreater(home_tight, 0.1)

    def test_recent_lines_count_more(self):
        # One team's lines say strong for weeks 1 to 8 and weak for 9 to 12.
        team = TEAMS[0]
        early = priced_season(8, 8, {**TRUE, team: 1.0})
        late = priced_season(12, 12, {**TRUE, team: -1.0})
        rows = [g for g in early if g['week'] <= 8] + [g for g in late if g['week'] > 8]
        fast, _ = tr.fit(rows, TEAMS, date(2024, 11, 24), None, half_life_weeks=2)
        slow, _ = tr.fit(rows, TEAMS, date(2024, 11, 24), None, half_life_weeks=math.inf)
        self.assertLess(fast[team], slow[team])

    def test_old_names_are_todays_franchises(self):
        self.assertEqual([tr.franchise(t) for t in ('STL', 'LA', 'SD', 'OAK', 'BUF')], ['LAR', 'LAR', 'LAC', 'LV', 'BUF'])


class PricingTests(unittest.TestCase):
    def setUp(self):
        self.pricer = tr.Pricer({'BUF': 0.4, 'KC': 0.1}, 0.2, sigma=0.6)

    def game(self, **kw):
        return {'game_id': 'g', 'home_team': 'BUF', 'away_team': 'KC', 'location': 'Home',
                'home_moneyline': None, 'away_moneyline': None, **kw}

    def test_a_game_with_a_line_keeps_it(self):
        g = self.game(home_moneyline=240, away_moneyline=-298)
        self.assertEqual(self.pricer([g]), playoff_odds.betting_lines([g]))

    def test_a_game_without_one_is_priced_from_the_ratings(self):
        self.assertAlmostEqual(self.pricer([self.game()])['g'], tr.logistic(0.4 - 0.1 + 0.2))

    def test_no_home_field_at_a_neutral_site(self):
        self.assertAlmostEqual(self.pricer([self.game(location='Neutral')])['g'], tr.logistic(0.3))

    def test_a_draw_moves_every_team_once_and_keeps_lines(self):
        drawn = self.pricer.draw(random.Random(7))
        again = self.pricer.draw(random.Random(7))
        self.assertEqual(drawn.ratings, again.ratings)
        self.assertNotEqual(drawn.ratings, self.pricer.ratings)
        self.assertEqual(drawn.sigma, 0)
        g = self.game(home_moneyline=-150, away_moneyline=130)
        self.assertEqual(drawn([g]), self.pricer([g]))

    def test_draws_have_the_spread_sigma_says(self):
        rng = random.Random(1)
        values = [self.pricer.draw(rng).ratings['BUF'] for _ in range(4000)]
        mean = sum(values) / len(values)
        sd = math.sqrt(sum((v - mean) ** 2 for v in values) / len(values))
        self.assertAlmostEqual(mean, 0.4, delta=0.03)
        self.assertAlmostEqual(sd, 0.6, delta=0.03)


class SeasonTests(unittest.TestCase):
    def test_last_seasons_final_ratings_carry_over(self):
        last = priced_season(18, 18, season=2023)
        this = priced_season(0, 0)
        pricer = tr.pricer(last + this, 2024)
        final = tr.final_ratings(last, 2023, TEAMS)
        # The final ratings are last season's, pulled in by the penalty.
        self.assertLess(sum(v * v for v in final.values()), sum(v * v for v in TRUE.values()))
        for t in TEAMS:
            self.assertAlmostEqual(final[t], TRUE[t], delta=0.2, msg=t)
            self.assertAlmostEqual(pricer.ratings[t], tr.CARRYOVER * final[t], places=9, msg=t)

    def test_the_odds_follow_the_ratings_and_rerun_identically(self):
        rows = priced_season(6, 7)
        build = lambda: playoff_odds.build_playoff_odds(rows, 2024, 'x', alignment=fixtures.ALIGNMENT, n=400)
        odds = build()
        self.assertEqual(odds, build())
        by_team = {t['team']: t for t in odds['teams']}
        best, worst = max(TRUE, key=TRUE.get), min(TRUE, key=TRUE.get)
        self.assertGreater(by_team[best]['meanWins'], by_team[worst]['meanWins'] + 3)
        self.assertEqual(odds['source'], 'betting lines and market ratings')

    def test_the_super_bowl_has_no_home_field(self):
        pricer = tr.Pricer({t: 0.0 for t in TEAMS}, 0.5, sigma=0)
        projection = playoff_odds.DraftProjection({'picks': [], 'choices': []}, TEAMS)
        projection.prepare([], 2024, pricer, 0, 0)
        self.assertAlmostEqual(projection._chance('SB', 'BUF', 'DET'), 0.5)
        self.assertAlmostEqual(projection._chance('DIV', 'BUF', 'KC'), tr.logistic(0.5))


if __name__ == '__main__':
    unittest.main()
