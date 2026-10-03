"""Target maps: which plays count, the depth bands' edges, the cells, and
when a player's file is removed."""

import unittest

from targets import build_targets, depth_band, grid, league_baseline, league_depth_share, stale_files, target_plays


def play(**fields):
    base = {'game_id': 'g1', 'week': 1, 'season_type': 'REG', 'pass_attempt': 1, 'play_type': 'pass',
            'two_point_attempt': 0, 'qb_spike': 0, 'sack': 0, 'receiver_player_id': 'wr1',
            'passer_player_id': 'qb1', 'pass_location': 'left', 'air_yards': 5.0, 'complete_pass': 1,
            'yards_gained': 8.0, 'pass_touchdown': 0, 'interception': 0, 'epa': 0.5}
    return {**base, **fields}


def cell(data, location, depth):
    return next(c for c in data['cells'] if c['location'] == location and c['depth'] == depth)


class DepthTests(unittest.TestCase):
    def test_band_edges(self):
        self.assertEqual(depth_band(-1), 'behind')
        self.assertEqual(depth_band(0), 'short')
        self.assertEqual(depth_band(9), 'short')
        self.assertEqual(depth_band(10), 'intermediate')
        self.assertEqual(depth_band(19), 'intermediate')
        self.assertEqual(depth_band(20), 'deep')

    def test_edges_land_in_the_right_cells(self):
        plays = [play(air_yards=0.0), play(air_yards=10.0), play(air_yards=20.0), play(air_yards=-3.0)]
        data = grid(plays, {})
        for depth in ('short', 'intermediate', 'deep', 'behind'):
            self.assertEqual(cell(data, 'left', depth)['targets'], 1, depth)


class FilterTests(unittest.TestCase):
    def test_a_null_pass_location_is_dropped_and_counted(self):
        kept, removed = target_plays([play(), play(pass_location=None)])
        self.assertEqual(len(kept), 1)
        self.assertEqual(dict(removed)['no pass location'], 1)

    def test_each_filter_counts_what_it_removes(self):
        plays = [
            play(),
            play(pass_attempt=0, play_type='run'),
            play(play_type='no_play'),
            play(two_point_attempt=1),
            play(qb_spike=1, receiver_player_id=None),
            play(sack=1, receiver_player_id=None),
            play(receiver_player_id=None),
            play(air_yards=None),
            play(epa=None),
        ]
        kept, removed = target_plays(plays)
        self.assertEqual(len(kept), 1)
        self.assertEqual(removed, [
            ('not a pass play', 1), ('nullified by penalty', 1), ('two-point attempts', 1), ('spikes', 1),
            ('sacks', 1), ('no receiver', 1), ('no pass location', 0), ('no air yards', 1), ('no EPA', 1),
        ])


class GridTests(unittest.TestCase):
    def test_cell_stats(self):
        plays = [
            play(epa=1.0, yards_gained=12.0, pass_touchdown=1),
            play(complete_pass=0, yards_gained=0.0, epa=-0.5),
            play(complete_pass=0, yards_gained=0.0, interception=1, epa=-3.5),
        ]
        c = cell(grid(plays, {('left', 'short'): 0.15}), 'left', 'short')
        self.assertEqual(
            {k: c[k] for k in ('targets', 'receptions', 'catchRate', 'yards', 'touchdowns', 'interceptions', 'epaPerTarget')},
            {'targets': 3, 'receptions': 1, 'catchRate': 0.333, 'yards': 12, 'touchdowns': 1, 'interceptions': 1,
             'epaPerTarget': -1.0},
        )
        self.assertEqual(c['leagueEpaPerTarget'], 0.15)

    def test_every_cell_is_present_deep_left_first(self):
        data = grid([play()], {})
        self.assertEqual(len(data['cells']), 12)
        self.assertEqual((data['cells'][0]['location'], data['cells'][0]['depth']), ('left', 'deep'))
        empty = cell(data, 'right', 'deep')
        self.assertEqual((empty['targets'], empty['catchRate'], empty['epaPerTarget']), (0, None, None))

    def test_baseline_is_the_league_per_cell(self):
        baseline = league_baseline([play(epa=1.0), play(epa=0.0), play(pass_location='middle', epa=-0.3)])
        self.assertEqual(baseline[('left', 'short')], 0.5)
        self.assertEqual(baseline[('middle', 'short')], -0.3)
        self.assertIsNone(baseline[('right', 'deep')])


    def test_league_depth_share(self):
        share = league_depth_share([play(air_yards=25.0), play(air_yards=0.0), play(air_yards=3.0), play(air_yards=-2.0)])
        self.assertEqual(share, {'deep': 0.25, 'intermediate': 0.0, 'short': 0.5, 'behind': 0.25})
        self.assertIsNone(league_depth_share([]))


class BuildTests(unittest.TestCase):
    def test_receivers_get_targets_and_passers_get_throws(self):
        plays = [play(receiver_player_id='wr1'), play(receiver_player_id='wr2'), play(receiver_player_id='qb1')]
        data = build_targets(plays, 2026, 4, [play()])
        self.assertEqual(sorted(data), ['qb1', 'wr1', 'wr2'])
        self.assertEqual(data['wr1']['targets']['total']['targets'], 1)
        self.assertIsNone(data['wr1']['throws'])
        # A passer who also caught one gets both grids.
        self.assertEqual(data['qb1']['throws']['total']['targets'], 3)
        self.assertEqual(data['qb1']['targets']['total']['targets'], 1)
        self.assertEqual(data['qb1']['baselineSeason'], 2025)

    def test_no_baseline_season_means_no_league_values(self):
        data = build_targets([play()], 2026, 1, [])
        self.assertIsNone(data['wr1']['baselineSeason'])
        self.assertIsNone(data['wr1']['leagueDepthShare'])
        self.assertTrue(all(c['leagueEpaPerTarget'] is None for c in data['wr1']['targets']['cells']))


class StaleFileTests(unittest.TestCase):
    existing = {'wr1': 2025, 'wr2': 2025}

    def test_preseason_keeps_last_seasons_files(self):
        # No regular season plays yet: nothing goes, even players not written.
        self.assertEqual(stale_files(self.existing, set(), None), [])

    def test_preseason_fallback_to_last_season_keeps_them_too(self):
        # The run falls back to last season and writes the same players again.
        self.assertEqual(stale_files(self.existing, {'wr1', 'wr2'}, 2025), [])

    def test_new_season_data_removes_players_without_targets(self):
        self.assertEqual(stale_files(self.existing, {'wr1'}, 2026), ['wr2'])

    def test_a_newer_file_is_never_removed_by_an_older_season(self):
        self.assertEqual(stale_files({'wr1': 2026}, set(), 2025), [])


if __name__ == '__main__':
    unittest.main()
