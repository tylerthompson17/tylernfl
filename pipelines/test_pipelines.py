"""Tests for the site data pipelines. No network or third party packages needed.

Run from the repo root:
    python -m unittest discover -s pipelines
"""

import unittest
from datetime import date
from pathlib import Path

from leaders import build_leaders
from ticker import WeekSpan, build_ticker, format_detail, kickoff_utc, next_opener, select_week

d = date.fromisoformat

# Real calendar shapes: the 2025 season (Thursday opener, Super Bowl on
# 2026-02-08) and the start of 2026 (Wednesday opener).
WEEKS = [
    WeekSpan(2025, 1, d('2025-09-04'), d('2025-09-08'), False),
    WeekSpan(2025, 2, d('2025-09-11'), d('2025-09-15'), False),
    WeekSpan(2025, 18, d('2026-01-03'), d('2026-01-04'), False),
    WeekSpan(2025, 19, d('2026-01-10'), d('2026-01-12'), False),
    WeekSpan(2025, 20, d('2026-01-17'), d('2026-01-18'), False),
    WeekSpan(2025, 21, d('2026-01-25'), d('2026-01-25'), False),
    WeekSpan(2025, 22, d('2026-02-08'), d('2026-02-08'), True),
    WeekSpan(2026, 1, d('2026-09-09'), d('2026-09-14'), False),
    WeekSpan(2026, 2, d('2026-09-17'), d('2026-09-21'), False),
]


def picked(today: str, weeks=WEEKS):
    week = select_week(weeks, d(today))
    return None if week is None else (week.season, week.week)


class SelectWeekTest(unittest.TestCase):
    def test_tuesday_shows_the_week_that_just_ended(self):
        self.assertEqual(picked('2025-09-09'), (2025, 1))

    def test_wednesday_shows_the_upcoming_week(self):
        self.assertEqual(picked('2025-09-10'), (2025, 2))

    def test_sunday_and_monday_show_the_week_in_progress(self):
        self.assertEqual(picked('2025-09-14'), (2025, 2))
        self.assertEqual(picked('2025-09-15'), (2025, 2))

    def test_bye_week_before_the_super_bowl_shows_the_super_bowl(self):
        self.assertEqual(picked('2026-01-28'), (2025, 22))
        self.assertEqual(picked('2026-02-03'), (2025, 22))

    def test_tuesday_after_the_super_bowl_still_shows_it(self):
        self.assertEqual(picked('2026-02-10'), (2025, 22))

    def test_offseason_after_the_super_bowl(self):
        self.assertIsNone(picked('2026-02-11'))
        self.assertIsNone(picked('2026-07-15'))
        self.assertEqual(next_opener(WEEKS, d('2026-07-15')).first_day, d('2026-09-09'))

    def test_opener_week_starts_the_season(self):
        self.assertIsNone(picked('2026-09-07'))
        self.assertEqual(picked('2026-09-08'), (2026, 1))
        self.assertEqual(picked('2026-09-09'), (2026, 1))

    def test_unscheduled_playoff_round_keeps_the_last_week(self):
        regular_season_only = [w for w in WEEKS if w.season == 2025 and w.week <= 18]
        self.assertEqual(picked('2026-01-07', regular_season_only), (2025, 18))


class FormatDetailTest(unittest.TestCase):
    def game(self, **overrides):
        base = {'gameday': '2025-09-14', 'gametime': '13:00', 'away_score': None, 'home_score': None, 'overtime': None}
        return {**base, **overrides}

    def test_upcoming_kickoffs(self):
        self.assertEqual(format_detail(self.game()), 'Sun 1:00 PM')
        self.assertEqual(format_detail(self.game(gametime='09:30')), 'Sun 9:30 AM')
        self.assertEqual(format_detail(self.game(gametime='12:00')), 'Sun 12:00 PM')
        self.assertEqual(format_detail(self.game(gameday='2025-09-15', gametime='20:15')), 'Mon 8:15 PM')
        self.assertEqual(format_detail(self.game(gametime=None)), 'Sun TBD')

    def test_finals(self):
        self.assertEqual(format_detail(self.game(away_score=20, home_score=17, overtime=0)), 'Final')
        self.assertEqual(format_detail(self.game(away_score=23, home_score=20, overtime=1)), 'Final/OT')


class KickoffTest(unittest.TestCase):
    def test_eastern_kickoff_to_utc_across_daylight_saving(self):
        self.assertEqual(kickoff_utc({'gameday': '2026-09-17', 'gametime': '20:15'}), '2026-09-18T00:15:00Z')
        self.assertEqual(kickoff_utc({'gameday': '2026-11-08', 'gametime': '13:00'}), '2026-11-08T18:00:00Z')

    def test_unscheduled_kickoff(self):
        self.assertIsNone(kickoff_utc({'gameday': '2027-01-16', 'gametime': None}))


class NoEspnInPipelinesTest(unittest.TestCase):
    def test_pipelines_never_fetch_espn(self):
        # ESPN data is browser-only (the live ticker). Pipelines use nflverse.
        for source in Path(__file__).resolve().parent.glob('*.py'):
            if source.name == Path(__file__).name:
                continue
            self.assertNotIn('espn.com', source.read_text(encoding='utf-8').lower(), source.name)


class BuildTickerTest(unittest.TestCase):
    def row(self, game_id, gameday, gametime, away, home, away_score=None, home_score=None, espn=None):
        return {
            'game_id': game_id, 'season': 2026, 'game_type': 'REG', 'week': 2,
            'gameday': gameday, 'gametime': gametime, 'away_team': away, 'home_team': home,
            'away_score': away_score, 'home_score': home_score, 'overtime': 0, 'espn': espn,
        }

    def test_kickoff_and_espn_id_fields(self):
        rows = [self.row('2026_02_DET_BUF', '2026-09-17', '20:15', 'DET', 'BUF', espn='401872932')]
        game = build_ticker(rows, d('2026-09-16'))['games'][0]
        self.assertEqual(game['kickoff'], '2026-09-18T00:15:00Z')
        self.assertEqual(game['espnId'], '401872932')

    def test_week_games_in_kickoff_order_with_rams_as_lar(self):
        rows = [
            self.row('2026_02_SF_LA', '2026-09-20', '16:25', 'SF', 'LA'),
            self.row('2026_02_DET_BUF', '2026-09-17', '20:15', 'DET', 'BUF', 27, 31),
            self.row('2026_02_KC_NYJ', '2026-09-20', '13:00', 'KC', 'NYJ'),
        ]
        ticker = build_ticker(rows, d('2026-09-19'))
        self.assertEqual(ticker['week'], 2)
        self.assertIsNone(ticker['nextOpener'])
        self.assertEqual([g['id'] for g in ticker['games']], ['2026_02_DET_BUF', '2026_02_KC_NYJ', '2026_02_SF_LA'])
        self.assertEqual(ticker['games'][2]['home'], 'LAR')
        self.assertEqual([g['state'] for g in ticker['games']], ['final', 'pre', 'pre'])

    def test_offseason_has_no_games(self):
        rows = [self.row('2026_02_DET_BUF', '2026-09-17', '20:15', 'DET', 'BUF', 27, 31)]
        ticker = build_ticker(rows, d('2027-03-01'))
        self.assertEqual(ticker['games'], [])
        self.assertIsNone(ticker['week'])
        self.assertIsNone(ticker['nextOpener'])


class BuildLeadersTest(unittest.TestCase):
    def row(self, pid, name, team, week, pass_yds=0, rush_yds=0, rec_yds=0):
        return {
            'player_id': pid, 'player_display_name': name, 'team': team, 'week': week,
            'passing_yards': pass_yds, 'rushing_yards': rush_yds, 'receiving_yards': rec_yds,
        }

    def test_totals_ties_latest_team_and_rams_abbreviation(self):
        rows = [
            self.row('a', 'Matthew Stafford', 'LA', 1, pass_yds=300),
            self.row('a', 'Matthew Stafford', 'LA', 2, pass_yds=250),
            self.row('b', 'Jared Goff', 'DET', 1, pass_yds=275),
            self.row('b', 'Jared Goff', 'DET', 2, pass_yds=275),
            self.row('c', 'Joe Flacco', 'CLE', 1, pass_yds=200),
            self.row('c', 'Joe Flacco', 'CIN', 2, pass_yds=350),
            self.row('d', 'Derrick Henry', 'BAL', 2, rush_yds=None),
        ]
        leaders = build_leaders(rows, 2026)
        self.assertEqual(leaders['throughWeek'], 2)
        passing = leaders['categories'][0]['rows']
        self.assertEqual(
            [(r['rank'], r['player'], r['team'], r['value']) for r in passing],
            [(1, 'Jared Goff', 'DET', 550), (1, 'Joe Flacco', 'CIN', 550), (1, 'Matthew Stafford', 'LAR', 550)],
        )
        # Players with no yards in a category are left out of it.
        self.assertEqual(leaders['categories'][1]['rows'], [])

    def test_no_stats_yet(self):
        leaders = build_leaders([], 2026)
        self.assertEqual(leaders['throughWeek'], 0)
        self.assertTrue(all(c['rows'] == [] for c in leaders['categories']))


if __name__ == '__main__':
    unittest.main()
