"""Standings and tiebreakers checked against nflseedR.

The fixtures (tests/fixtures/standings/, made by generate.R there) are
nflseedR's standings after every week from 4 to 18 of 2022, 2023 and 2024,
43 snapshots with every tiebreaker step in play. For each one the port must
give the same records, the same strength of victory and schedule, and the
same division and conference ranks, except where nflseedR settled a tie
by coin toss, which it draws at random.
"""

import csv
import unittest
from collections import defaultdict
from pathlib import Path

import standings

FIXTURES = Path(__file__).resolve().parent.parent / 'tests' / 'fixtures' / 'standings'


def _number(text: str):
    return None if text == '' else float(text)


def load_games() -> dict[int, list[dict]]:
    games = defaultdict(list)
    with open(FIXTURES / 'games.csv') as f:
        for row in csv.DictReader(f):
            games[int(row['season'])].append({
                'week': int(row['week']),
                'game_type': row['game_type'],
                'away_team': row['away_team'],
                'home_team': row['home_team'],
                'away_score': _number(row['away_score']),
                'home_score': _number(row['home_score']),
            })
    return games


def load_expected() -> dict[tuple[int, int], dict[str, dict]]:
    snapshots = defaultdict(dict)
    with open(FIXTURES / 'nflseedr.csv') as f:
        for row in csv.DictReader(f):
            snapshots[(int(row['season']), int(row['through_week']))][row['team']] = row
    return snapshots


GAMES = load_games()
EXPECTED = load_expected()
ALIGNMENT = standings.load_alignment()


def compute(season: int, week: int) -> dict:
    played = [g for g in GAMES[season] if g['week'] <= week]
    return standings.compute(played, ALIGNMENT)


class FixtureTests(unittest.TestCase):
    def test_fixtures_cover_what_they_should(self):
        self.assertEqual(len(EXPECTED), 43)
        self.assertTrue(all(len(teams) == 32 for teams in EXPECTED.values()))

    def test_records_match_nflseedr(self):
        for (season, week), expected in EXPECTED.items():
            table = compute(season, week)
            for team, row in expected.items():
                ours = table[team]
                with self.subTest(season=season, week=week, team=team):
                    self.assertEqual(ours['games'], int(row['games']))
                    self.assertEqual(ours['wins'], float(row['wins']))
                    self.assertEqual(ours['losses'], int(row['losses']))
                    self.assertEqual(ours['ties'], int(row['ties']))
                    self.assertEqual(ours['pf'], float(row['pf']))
                    self.assertEqual(ours['pa'], float(row['pa']))
                    for key in ('win_pct', 'div_pct', 'conf_pct', 'sov', 'sos'):
                        self.assertAlmostEqual(ours[key], float(row[key]), places=12, msg=key)

    def test_division_ranks_match_nflseedr(self):
        mismatches = []
        for (season, week), expected in EXPECTED.items():
            table = compute(season, week)
            for team, row in expected.items():
                if 'Coin' in row['div_tie_broken_by']:
                    continue
                if table[team]['div_rank'] != int(row['div_rank']):
                    mismatches.append((season, week, team, table[team]['div_rank'], row['div_rank']))
        self.assertEqual(mismatches, [])

    def test_conference_ranks_match_nflseedr(self):
        mismatches = []
        for (season, week), expected in EXPECTED.items():
            table = compute(season, week)
            if any('Coin' in r['conf_tie_broken_by'] or 'Coin' in r['div_tie_broken_by'] for r in expected.values()):
                continue  # a random draw anywhere can move the others
            for team, row in expected.items():
                if table[team]['conf_rank'] != int(row['conf_rank']):
                    mismatches.append((season, week, team, table[team]['conf_rank'], row['conf_rank']))
        self.assertEqual(mismatches, [])

    def test_the_step_that_broke_each_tie_matches_nflseedr(self):
        mismatches = []
        for (season, week), expected in EXPECTED.items():
            table = compute(season, week)
            for team, row in expected.items():
                for ours_key, theirs_key in (('div_broken_by', 'div_tie_broken_by'), ('conf_broken_by', 'conf_tie_broken_by')):
                    theirs = row[theirs_key] or None
                    if theirs and 'Coin' in theirs:
                        continue
                    if table[team][ours_key] != theirs:
                        mismatches.append((season, week, team, ours_key, table[team][ours_key], theirs))
        self.assertEqual(mismatches, [])

    def test_final_seeds(self):
        # The real playoff fields, as a plain check on top of nflseedR.
        seeds = {
            2023: {'AFC': ['BAL', 'BUF', 'KC', 'HOU', 'CLE', 'MIA', 'PIT'],
                   'NFC': ['SF', 'DAL', 'DET', 'TB', 'PHI', 'LAR', 'GB']},
            2024: {'AFC': ['KC', 'BUF', 'BAL', 'HOU', 'LAC', 'PIT', 'DEN'],
                   'NFC': ['DET', 'PHI', 'TB', 'LAR', 'MIN', 'WAS', 'GB']},
        }
        for season, by_conf in seeds.items():
            table = compute(season, 18)
            for conf, order in by_conf.items():
                ours = sorted((r for r in table.values() if r['conf'] == conf), key=lambda r: r['conf_rank'])[:7]
                self.assertEqual([r['team'] for r in ours], order, f'{season} {conf}')


class RecordTests(unittest.TestCase):
    def test_a_tie_is_half_a_win_and_streaks_read_as_the_latest_run(self):
        table = compute(2022, 18)
        # 2022: NYG tied WAS, IND tied HOU.
        self.assertEqual((table['NYG']['ties'], table['WAS']['ties']), (1, 1))
        self.assertEqual(table['NYG']['win_pct'], (table['NYG']['true_wins'] + 0.5) / table['NYG']['games'])
        self.assertRegex(table['BUF']['streak'], r'^[WLT]\d+$')


if __name__ == '__main__':
    unittest.main()
