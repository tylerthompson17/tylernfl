"""EPA per dropback and rush EPA: which plays count, whose they are, and
who qualifies."""

import unittest

from player_epa import build_player_epa, designed_runs, dropback_plays


def play(**fields):
    base = {'game_id': 'g1', 'week': 1, 'season_type': 'REG', 'posteam': 'BUF', 'play_type': 'pass',
            'qb_dropback': 1, 'qb_scramble': 0, 'two_point_attempt': 0, 'qb_epa': 0.0, 'epa': 0.0,
            'id': 'qb1', 'name': 'J.Allen', 'rusher_player_id': None, 'rusher_player_name': None}
    return {**base, **fields}


class PlayTests(unittest.TestCase):
    def test_dropbacks_are_passes_sacks_and_scrambles_but_not_two_point_tries(self):
        plays = [
            play(),                                           # pass
            play(qb_epa=-1.5),                                # sack (play_type pass)
            play(play_type='run', qb_scramble=1),             # scramble
            play(two_point_attempt=1),                        # two-point try
            play(qb_dropback=0, play_type='run', id=None),    # designed run
            play(play_type='no_play'),                        # penalty
        ]
        self.assertEqual(len(dropback_plays(plays)), 3)

    def test_designed_runs_leave_out_scrambles(self):
        plays = [
            play(qb_dropback=0, play_type='run', rusher_player_id='rb1', epa=0.4),
            play(play_type='run', qb_scramble=1, rusher_player_id='qb1', epa=1.0),
            play(qb_dropback=0, play_type='run', rusher_player_id='rb1', epa=0.2, two_point_attempt=1),
        ]
        self.assertEqual([p['epa'] for p in designed_runs(plays)], [0.4])


class BuildTests(unittest.TestCase):
    def build(self, plays, people=None):
        return build_player_epa(plays, 2026, 1, 'x', people or {})

    def test_epa_per_dropback_uses_qb_epa_and_the_board_name(self):
        plays = [play(qb_epa=0.5)] * 10 + [play(qb_epa=-0.1)] * 10
        data = self.build(plays, {'qb1': ('Josh Allen', 'BUF')})
        row = data['categories'][0]['rows'][0]
        self.assertEqual((row['player'], row['team'], row['value'], row['plays']), ('Josh Allen', 'BUF', 0.2, 20))

    def test_the_qualifier_is_per_team_game(self):
        # BUF has played two games: 14 per game means 28 dropbacks.
        plays = [play(game_id='g1')] * 20 + [play(game_id='g2')] * 7
        self.assertEqual(self.build(plays)['categories'][0]['rows'], [])
        plays += [play(game_id='g2')]
        self.assertEqual(len(self.build(plays)['categories'][0]['rows']), 1)

    def test_equal_values_share_a_rank(self):
        plays = [play(id='a', qb_epa=0.1)] * 14 + [play(id='b', qb_epa=0.1)] * 14 + [play(id='c', qb_epa=0.3)] * 14
        people = {'a': ('A Passer', 'BUF'), 'b': ('B Passer', 'BUF'), 'c': ('C Passer', 'BUF')}
        rows = self.build(plays, people)['categories'][0]['rows']
        self.assertEqual([(r['player'], r['rank']) for r in rows], [('C Passer', 1), ('A Passer', 2), ('B Passer', 2)])

    def test_a_player_off_the_boards_keeps_his_play_by_play_name(self):
        plays = [play(qb_dropback=0, play_type='run', rusher_player_id='rb9', rusher_player_name='Z.Back', epa=0.1)] * 6
        row = self.build(plays)['categories'][1]['rows'][0]
        self.assertEqual((row['player'], row['team']), ('Z.Back', 'BUF'))


if __name__ == '__main__':
    unittest.main()
