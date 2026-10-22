"""Draft order checked against the league's.

tests/fixtures/draft/games_2025.csv is nflverse's 2025 schedule (regular
season and playoffs), saved with nflreadpy.load_schedules([2025]) and the
standings fixtures' columns. 2026_round1.json is the league's round 1 order
for the 2026 draft by original team, and who held the traded picks, from
NFL.com (source in the file). The 2025 season must give that order exactly.

Every 2025 tie was settled by strength of schedule (four teams at 3-14,
three at 6-11, four at 8-9, three playoff teams out in the divisional round
at 12-5), so the steps after it are checked on small made-up seasons.
"""

import csv
import json
import tempfile
import unittest
from pathlib import Path

import draft_order
import standings

FIXTURES = Path(__file__).resolve().parent.parent / 'tests' / 'fixtures' / 'draft'
ALIGNMENT = standings.load_alignment()
TEAMS = set(ALIGNMENT)
SOURCE = 'https://example.com/trade'


def load_games() -> list[dict]:
    with open(FIXTURES / 'games_2025.csv') as f:
        return [
            {
                'season': int(r['season']), 'week': int(r['week']), 'game_type': r['game_type'],
                'away_team': r['away_team'], 'home_team': r['home_team'],
                'away_score': float(r['away_score']) if r['away_score'] else None,
                'home_score': float(r['home_score']) if r['home_score'] else None,
            }
            for r in csv.DictReader(f)
        ]


GAMES = load_games()
EXPECTED = json.loads((FIXTURES / '2026_round1.json').read_text())


def picks_file(data: dict) -> Path:
    f = tempfile.NamedTemporaryFile('w', suffix='.json', delete=False)
    json.dump(data, f)
    f.close()
    return Path(f.name)


def traded(original: str, owner: str | None, draft: int = 2026) -> dict:
    status = 'forfeited' if owner is None else 'traded'
    return {'draft': draft, 'original': original, 'owner': owner, 'status': status, 'source': SOURCE}


def game(away: str, home: str, away_score: int, home_score: int, week: int = 1) -> dict:
    return {'season': 2025, 'week': week, 'game_type': 'REG', 'away_team': away, 'home_team': home,
            'away_score': away_score, 'home_score': home_score}


def tie(games: list[dict], teams: list[str]) -> list[tuple[str, str]]:
    table, h2h = standings.records(games, ALIGNMENT)
    return draft_order.break_tie(table, h2h, teams, standings.by_abbreviation)


class LeagueOrderTests(unittest.TestCase):
    def test_2025_gives_the_leagues_2026_order(self):
        owners = picks_file({'picks': [traded(t, o) for t, o in EXPECTED['owners'].items()]})
        data = draft_order.build_draft_order(GAMES, 2025, 'now', ALIGNMENT, owners)
        self.assertEqual(data['stage'], 'final')
        self.assertEqual([p['team'] for p in data['picks']], EXPECTED['order'])
        self.assertEqual({p['team']: p['owner'] for p in data['picks'] if p['owner'] != p['team']},
                         EXPECTED['owners'])
        self.assertFalse(any(p['coinFlip'] for p in data['picks']))

    def test_2025_groups_and_steps(self):
        data = draft_order.build_draft_order(GAMES, 2025, 'now', ALIGNMENT, picks_file({}))
        groups = [p['group'] for p in data['picks']]
        self.assertEqual(groups, ['non_playoff'] * 18 + ['wild_card'] * 6 + ['divisional'] * 4
                         + ['conference'] * 2 + ['super_bowl', 'champion'])
        first = data['picks'][0]
        self.assertEqual((first['team'], first['wins'], first['losses'], first['tiebreak']),
                         ('LV', 3, 14, 'strength_of_schedule'))
        # Alone on its record: no tiebreak.
        self.assertIsNone(data['picks'][4]['tiebreak'])

    def test_before_the_playoffs_playoff_teams_go_by_record(self):
        regular = [g for g in GAMES if g['game_type'] == 'REG']
        data = draft_order.build_draft_order(regular, 2025, 'now', ALIGNMENT, picks_file({}))
        self.assertEqual(data['stage'], 'playoffs')
        late = data['picks'][18:]
        self.assertTrue(all(p['group'] == 'alive' for p in late))
        self.assertEqual([p['pct'] for p in late], sorted(p['pct'] for p in late))
        # Carolina won its division at 8-9 and still picks after every
        # team that missed the playoffs.
        self.assertEqual(late[0]['team'], 'CAR')

    def test_mid_season(self):
        # The schedule as it stood after week 8: later games unplayed.
        through_8 = [g if g['week'] <= 8 else {**g, 'away_score': None, 'home_score': None}
                     for g in GAMES if g['game_type'] == 'REG']
        data = draft_order.build_draft_order(through_8, 2025, 'now', ALIGNMENT, picks_file({}))
        self.assertEqual((data['stage'], data['throughWeek'], len(data['picks'])), ('regular_season', 8, 32))

    def test_before_the_first_game(self):
        data = draft_order.build_draft_order([], 2025, 'now', ALIGNMENT, picks_file({}))
        self.assertEqual((data['draft'], data['stage'], data['picks']), (2026, 'not_started', []))


class TiebreakTests(unittest.TestCase):
    def test_one_division_reverses_the_standings_tiebreak(self):
        # Both 1-1, but BUF beat MIA, so MIA picks first.
        games = [game('MIA', 'BUF', 10, 20, 1), game('BUF', 'NE', 10, 20, 2), game('NYJ', 'MIA', 10, 20, 2)]
        self.assertEqual(tie(games, ['BUF', 'MIA']),
                         [('MIA', 'head_to_head'), ('BUF', 'head_to_head')])

    def test_two_conferences_go_to_head_to_head(self):
        self.assertEqual(tie([game('DAL', 'BUF', 10, 20)], ['BUF', 'DAL']),
                         [('DAL', 'head_to_head'), ('BUF', 'head_to_head')])

    def test_two_conferences_then_common_games_of_at_least_four(self):
        opponents = ['NYG', 'PHI', 'WAS', 'NE']
        games = [game('DAL', o, 20, 10, w) for w, o in enumerate(opponents, 1)]
        games += [game('BUF', o, 10, 20, w) for w, o in enumerate(opponents[:3], 1)]
        games += [game('BUF', 'NE', 20, 10, 4)]
        self.assertEqual(tie(games, ['BUF', 'DAL']),
                         [('BUF', 'common_games'), ('DAL', 'common_games')])
        # Three common games are not enough: on to strength of victory.
        # DAL beat three teams that then won once between them; BUF beat
        # one that won once.
        short = [game('DAL', o, 20, 10, w) for w, o in enumerate(opponents[:3], 1)]
        short += [game('BUF', 'NE', 20, 10, 1), game('NE', 'NYG', 20, 10, 2)]
        table, _ = standings.records(short, ALIGNMENT)
        self.assertLess(table['DAL']['sov'], table['BUF']['sov'])
        self.assertEqual(tie(short, ['BUF', 'DAL'])[0], ('DAL', 'strength_of_victory'))

    def test_a_tie_with_nothing_to_go_on_is_a_coin_toss(self):
        self.assertEqual(tie([], ['DAL', 'BUF']), [('BUF', 'coin_toss'), ('DAL', 'coin_toss')])
        table, h2h = standings.records([], ALIGNMENT)
        drawn = draft_order.break_tie(table, h2h, ['BUF', 'DAL'], lambda r: r['team'] == 'BUF')
        self.assertEqual(drawn[0][0], 'DAL')

    def test_three_teams_two_conferences_restart_after_each_pick(self):
        # AFC: MIA lost to BUF, so MIA is the AFC's first. DAL lost to MIA.
        games = [game('MIA', 'BUF', 10, 20, 1), game('DAL', 'MIA', 10, 20, 2)]
        order = [t for t, _ in tie(games, ['BUF', 'MIA', 'DAL'])]
        self.assertEqual(order[0], 'DAL')
        self.assertEqual(order[1:], ['MIA', 'BUF'])

    def test_a_coin_toss_in_the_current_order_is_marked(self):
        # After week 1 each 1-0 team's opponents are 0-1 and each 0-1
        # team's 1-0, with no second game to tell them apart: all flips.
        games = [g for g in GAMES if g['game_type'] == 'REG' and g['week'] <= 1]
        data = draft_order.build_draft_order(games, 2025, 'now', ALIGNMENT, picks_file({}))
        self.assertTrue(all(p['coinFlip'] and p['tiebreak'] == 'coin_toss' for p in data['picks']))
        self.assertEqual([p['team'] for p in data['picks'][:16]],
                         sorted(p['team'] for p in data['picks'][:16]))


class PickTests(unittest.TestCase):
    ORDER = ['LV', 'NYJ', 'DAL', 'ARI', 'GB']

    def test_a_choice_gives_the_earlier_pick_and_leaves_the_other(self):
        picks = {'picks': [traded('GB', 'DAL', 2027)],
                 'choices': [{'between': ['DAL', 'GB'], 'takes': 'earlier', 'from': 'DAL', 'to': 'NYJ'}]}
        slots = draft_order.apply_picks(self.ORDER, picks)
        owners = {s['team']: s['owner'] for s in slots}
        self.assertEqual((owners['DAL'], owners['GB']), ('NYJ', 'DAL'))
        swapped = draft_order.apply_picks(['LV', 'GB', 'DAL'], picks)
        self.assertEqual({s['team']: s['owner'] for s in swapped}, {'LV': 'LV', 'GB': 'NYJ', 'DAL': 'DAL'})
        self.assertEqual(slots[2]['choice'], {'between': ['DAL', 'GB'], 'takes': 'earlier', 'to': 'NYJ'})

    def test_a_forfeited_pick_is_dropped_and_later_picks_move_up(self):
        slots = draft_order.apply_picks(self.ORDER, {'picks': [traded('DAL', None)], 'choices': []})
        self.assertEqual([s['team'] for s in slots], ['LV', 'NYJ', 'ARI', 'GB'])

    def test_the_picks_file_loads(self):
        picks = draft_order.load_picks(2027, TEAMS)
        self.assertGreater(len(picks['picks']), 0)

    def test_bad_entries_are_refused(self):
        bad = [
            {'picks': [{**traded('GB', 'DAL'), 'source': ''}]},
            {'picks': [traded('GB', 'XYZ')]},
            {'picks': [traded('GB', 'DAL'), traded('GB', 'NYJ')]},
            {'picks': [{**traded('GB', 'DAL'), 'status': 'forfeited'}]},
            {'picks': [], 'choices': [{'draft': 2026, 'from': 'DAL', 'to': 'NYJ', 'between': ['DAL', 'GB'],
                                       'takes': 'earlier', 'source': SOURCE}]},
        ]
        for data in bad:
            with self.subTest(data=data), self.assertRaises(ValueError):
                draft_order.load_picks(2026, TEAMS, picks_file(data))


class TradeCheckTests(unittest.TestCase):
    def test_trades_missing_from_the_file_are_named(self):
        path = picks_file({
            'picks': [traded('LAR', 'CLE', 2027)],
            'choices': [{'draft': 2027, 'from': 'DAL', 'to': 'NYJ', 'between': ['DAL', 'GB'],
                         'takes': 'earlier', 'source': SOURCE}],
        })
        rows = [
            {'trade_id': 1, 'trade_date': '2026-06-01', 'gave': 'LA', 'received': 'CLE',
             'pick_season': 2027, 'pick_round': 1, 'conditional': 0},
            {'trade_id': 2, 'trade_date': '2025-11-04', 'gave': 'DAL', 'received': 'NYJ',
             'pick_season': 2027, 'pick_round': 1, 'conditional': 0},
            {'trade_id': 3, 'trade_date': '2025-11-04', 'gave': 'IND', 'received': 'NYJ',
             'pick_season': 2027, 'pick_round': 1, 'conditional': 1},
            {'trade_id': 4, 'trade_date': '2025-11-04', 'gave': 'IND', 'received': 'NYJ',
             'pick_season': 2027, 'pick_round': 2, 'conditional': 0},
            {'trade_id': 5, 'trade_date': '2025-04-24', 'gave': 'ATL', 'received': 'LA',
             'pick_season': 2026, 'pick_round': 1, 'conditional': 0},
        ]
        self.assertEqual(draft_order.unlisted_trades(rows, path),
                         ['2027 round 1 pick, IND to NYJ, traded 2025-11-04 (conditional), trade 3'])


if __name__ == '__main__':
    unittest.main()
