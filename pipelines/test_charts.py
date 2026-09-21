"""Tests for the chart pipeline: the shared style module, the auto chart
templates, and the logo download. Run with the other pipeline tests:
    python -m unittest discover -s pipelines
"""

import importlib.util
import tempfile
import unittest
from datetime import date
from pathlib import Path

from build_logos import logo_urls
from charts import auto, style

HAS_MATPLOTLIB = importlib.util.find_spec('matplotlib') is not None


class TokenTests(unittest.TestCase):
    def test_colors_and_fonts_come_from_tokens_css(self):
        tokens = style.read_tokens()
        self.assertEqual(style.HEADER, tokens['header'])
        self.assertEqual(style.LINK, tokens['link'])
        self.assertEqual(style.FONT_BODY, 'Barlow')
        self.assertEqual(style.FONT_HEADING, 'Barlow Condensed')

    def test_comments_in_tokens_css_are_ignored(self):
        with tempfile.NamedTemporaryFile('w', suffix='.css', delete=False) as f:
            f.write(':root {\n  /* --fake: #000; */\n  --bg: #e9ebee; /* page */\n}\n')
        self.assertEqual(style.read_tokens(Path(f.name)), {'bg': '#e9ebee'})

    def test_yellow_is_never_a_series_color(self):
        self.assertNotIn(style.HIGHLIGHT, style.SERIES)


SAMPLE_SVG = '''<?xml version="1.0" encoding="utf-8" standalone="no"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg xmlns:xlink="http://www.w3.org/1999/xlink" width="720pt" height="405pt" viewBox="0 0 720 405" xmlns="http://www.w3.org/2000/svg" version="1.1">
 <metadata>created today</metadata>
 <defs>
  <style type="text/css">*{stroke-linejoin: round; stroke-linecap: butt}</style>
 </defs>
 <g id="figure_1">
  <clipPath id="p1a2b"><rect/></clipPath>
  <path clip-path="url(#p1a2b)"/>
  <use xlink:href="#m9f" x="1"/>
  <g id="logo-BUF-1">
   <image xlink:href="data:image/png;base64,iVBORw0KGgo=" id="image5" transform="scale(1 -1) translate(0 -24)" x="344" y="-183" width="24" height="24"/>
  </g>
  <text style="font-size: 12px; font-family: 'Barlow', 'DejaVu Sans', 'Arial', sans-serif; fill: #5b6570">1</text>
  <text style="font-weight: 700; font-family: 'Barlow Condensed'; fill: #1a56b5">BUF</text>
 </g>
</svg>
'''


class InlineSvgTests(unittest.TestCase):
    def setUp(self):
        self.svg = style.inline_svg(SAMPLE_SVG, 'epa-tiers')

    def test_standalone_preamble_and_metadata_are_gone(self):
        self.assertNotIn('<?xml', self.svg)
        self.assertNotIn('DOCTYPE', self.svg)
        self.assertNotIn('metadata', self.svg)
        self.assertTrue(self.svg.startswith('<svg'))

    def test_scales_to_its_container(self):
        root = self.svg.split('>', 1)[0]
        self.assertIn('viewBox="0 0 720 405"', root)
        self.assertNotIn('width=', root)
        self.assertNotIn('height=', root)

    def test_ids_and_references_are_prefixed_together(self):
        self.assertIn('id="epa-tiers-p1a2b"', self.svg)
        self.assertIn('url(#epa-tiers-p1a2b)', self.svg)
        self.assertIn('xlink:href="#epa-tiers-m9f"', self.svg)
        self.assertNotIn('id="figure_1"', self.svg)

    def test_the_global_style_rule_is_scoped_to_the_chart(self):
        self.assertIn('class="chart-svg chart-epa-tiers"', self.svg)
        self.assertIn('.chart-epa-tiers *{stroke-linejoin', self.svg)
        self.assertNotIn('>*{', self.svg)

    def test_logos_become_references_and_nothing_is_embedded(self):
        self.assertIn('xlink:href="logo:BUF"', self.svg)
        self.assertNotIn('base64', self.svg)

    def test_logos_lose_the_flip_that_only_embedded_pictures_need(self):
        # matplotlib stores embedded pictures upside down and flips them
        # back; the logo file is already the right way up. Same place on
        # the page: top edge at 183, 24 tall.
        image = self.svg[self.svg.index('<image'):].split('>', 1)[0]
        self.assertNotIn('transform', image)
        self.assertIn('x="344" y="183"', image)
        self.assertIn('width="24" height="24"', image)

    def test_fonts_use_the_site_stacks(self):
        self.assertIn(f"font-family: {style.TOKENS['font-body']}", self.svg)
        self.assertIn(f"font-family: {style.TOKENS['font-heading']}", self.svg)
        self.assertNotIn('DejaVu', self.svg)


class SpreadTests(unittest.TestCase):
    def test_labels_far_apart_stay_put(self):
        self.assertEqual(style.spread([0, 50, 100], 20), [0, 50, 100])

    def test_colliding_labels_center_on_their_lines_and_others_stay(self):
        placed = style.spread([0, 5, 6, 100], 20)
        self.assertEqual(placed[3], 100)
        self.assertAlmostEqual(sum(placed[:3]) / 3, (0 + 5 + 6) / 3)
        self.assertEqual([round(b - a, 6) for a, b in zip(placed, placed[1:3])], [20, 20])

    def test_order_is_kept_and_results_follow_the_input_order(self):
        placed = style.spread([10, 0, 12], 20)
        self.assertLess(placed[1], placed[0])
        self.assertLess(placed[0], placed[2])

    def test_groups_that_collide_after_spreading_merge(self):
        placed = sorted(style.spread([0, 1, 30, 31], 20))
        self.assertTrue(all(b - a >= 20 - 1e-9 for a, b in zip(placed, placed[1:])))


def game(away, home, away_score, home_score, gametime='13:00', day='2026-09-20', **extra):
    return {'game_id': f'2026_02_{away}_{home}', 'season': 2026, 'gameday': day, 'gametime': gametime,
            'away_team': away, 'home_team': home, 'away_score': away_score, 'home_score': home_score, **extra}


class PickingTests(unittest.TestCase):
    def test_closest_game_is_the_smallest_margin_on_that_day(self):
        rows = [game('DET', 'BUF', 31, 41), game('IND', 'KC', 30, 33), game('SEA', 'ARI', 31, 7),
                game('NYG', 'LAR', 20, 21, day='2026-09-21')]
        self.assertEqual(auto.closest_game(rows, date(2026, 9, 20))['home_team'], 'KC')

    def test_equal_margins_go_to_the_later_kickoff(self):
        rows = [game('A', 'B', 20, 17, '13:00'), game('C', 'D', 24, 21, '20:20'), game('E', 'F', 10, 13, '16:25')]
        self.assertEqual(auto.closest_game(rows, date(2026, 9, 20))['away_team'], 'C')

    def test_no_final_game_that_day_means_no_game(self):
        rows = [game('A', 'B', None, None), game('C', 'D', 20, 17, day='2026-09-19')]
        self.assertIsNone(auto.closest_game(rows, date(2026, 9, 20)))

    def test_other_templates_need_enough_data(self):
        stats = {'teams': [{'values': {'off_epa': {'value': 0.1}}}]}
        empty = {'teams': [{'values': {'off_epa': {'value': None}}}]}
        self.assertEqual(auto.other_templates(stats, 2), ['epa'])
        self.assertEqual(auto.other_templates(stats, 4), ['epa', 'race'])
        self.assertEqual(auto.other_templates(empty, 3), [])
        self.assertEqual(auto.other_templates(None, 6), ['race'])

    def test_the_date_decides_so_a_rerun_matches(self):
        day = date(2026, 10, 7)
        self.assertEqual(auto.pick_other(['epa', 'race'], day), auto.pick_other(['epa', 'race'], day))
        picks = {auto.pick_other(['epa', 'race'], date(2026, 10, d)) for d in range(1, 5)}
        self.assertEqual(picks, {'epa', 'race'})
        self.assertIsNone(auto.pick_other([], day))

    def test_race_days_cycle_through_the_three_boards(self):
        boards = {auto.race_board(date(2026, 10, d))[0] for d in range(1, 7)}
        self.assertEqual(boards, {'passing', 'rushing', 'receiving'})


def play(play_id, qtr, remaining, wp):
    return {'play_id': play_id, 'qtr': qtr, 'game_seconds_remaining': remaining, 'home_wp': wp}


class WinProbabilityTests(unittest.TestCase):
    def test_plays_are_put_in_order_and_unusable_rows_dropped(self):
        plays = auto.wp_plays([play(30, 1, 800, 0.6), play(10, 1, 900, 0.5), play(20, 1, 850, None)])
        self.assertEqual([p['play_id'] for p in plays], [10, 30])

    def test_overtime_runs_on_from_minute_sixty(self):
        self.assertEqual(auto.elapsed_minutes(1, 3600), 0)
        self.assertEqual(auto.elapsed_minutes(4, 0), 60)
        self.assertEqual(auto.elapsed_minutes(5, 600), 60)
        self.assertEqual(auto.elapsed_minutes(5, 300), 65)

    def test_clock_reads_as_a_viewer_saw_it(self):
        self.assertEqual(auto.clock_label(4, 130), 'Q4 2:10')
        self.assertEqual(auto.clock_label(2, 1800 + 5), 'Q2 0:05')
        self.assertEqual(auto.clock_label(5, 313), 'OT 5:13')

    def test_points_end_on_the_result(self):
        points = auto.wp_points([play(1, 1, 3600, 0.55), play(2, 4, 10, 0.9)], 20, 24)
        self.assertEqual(points[0], (0.0, 0.55))
        self.assertEqual(points[-1], (60.0, 1.0))

    def test_note_gives_the_winners_lowest_point(self):
        plays = [play(1, 1, 3600, 0.6), play(2, 4, 130, 0.12), play(3, 4, 5, 0.8)]
        note = auto.wp_note(game('IND', 'KC', 30, 33), plays)
        self.assertEqual(note, "KC beat IND 33 to 30. KC's chance fell as low as 12%, at Q4 2:10.")

    def test_note_for_a_road_win_uses_the_road_teams_chance(self):
        plays = [play(1, 1, 3600, 0.7), play(2, 3, 1200, 0.95), play(3, 4, 60, 0.2)]
        note = auto.wp_note(game('DET', 'BUF', 27, 24, overtime=1), plays)
        self.assertEqual(note, "DET beat BUF 27 to 24 in overtime. DET's chance fell as low as 5%, at Q3 5:00.")

    def test_note_for_a_wire_to_wire_favorite(self):
        plays = [play(1, 1, 3600, 0.62), play(2, 4, 60, 0.97)]
        self.assertEqual(auto.wp_note(game('SEA', 'ARI', 7, 31), plays),
                         'ARI beat SEA 31 to 7. ARI was favored the whole way, never below 62%.')

    def test_note_for_a_tie(self):
        self.assertEqual(auto.wp_note(game('A', 'B', 20, 20, overtime=1), []), 'A and B tied 20 to 20 in overtime.')


def log_file(team, players, board='receiving', columns=('receptions', 'receiving_yards')):
    return {'season': 2026, 'team': team, 'columns': {board: list(columns)},
            'players': {pid: {'name': name, 'boards': {board: rows}} for pid, (name, rows) in players.items()}}


class RaceTests(unittest.TestCase):
    def test_running_totals_for_the_top_players_best_first(self):
        logs = [
            log_file('CIN', {'p1': ("Ja'Marr Chase", [[1, 'CIN', 'CLE', 1, 'W', 7, 100], [2, 'CIN', 'JAX', 0, 'L', 9, 150]])}),
            log_file('SEA', {'p2': ('Jaxon Smith-Njigba', [[1, 'SEA', 'SF', 1, 'W', 5, 90], [3, 'SEA', 'ARI', 0, 'W', 8, 200]])}),
            log_file('NO', {'p3': ('Chris Olave', [[1, 'NO', 'DET', 0, 'L', 10, 80]])}),
        ]
        last, series = auto.race_series(logs, 'receiving', 'receiving_yards', top=2)
        self.assertEqual(last, 3)
        self.assertEqual(series, [
            ('Jaxon Smith-Njigba', 'SEA', [90, 90, 290]),
            ("Ja'Marr Chase", 'CIN', [100, 250, 250]),
        ])

    def test_a_log_in_two_team_files_counts_once(self):
        rows = [[1, 'NYJ', 'BUF', 1, 'L', 6, 110]]
        logs = [log_file('NYJ', {'p1': ('Garrett Wilson', rows)}), log_file('PIT', {'p1': ('Garrett Wilson', rows)})]
        _, series = auto.race_series(logs, 'receiving', 'receiving_yards')
        self.assertEqual(series[0][2], [110])

    def test_note(self):
        series = [('Chris Olave', 'NO', [182, 450]), ('Zay Flowers', 'BAL', [150, 420])]
        self.assertEqual(auto.race_note('Receiving yards', series),
                         'Chris Olave leads with 450 receiving yards, 30 ahead of Zay Flowers.')
        level = [('A', 'X', [300]), ('B', 'Y', [300])]
        self.assertEqual(auto.race_note('Rushing yards', level), 'A and B are level at 300 rushing yards.')

    def test_short_names_match_the_ticker(self):
        self.assertEqual(auto.short_name("Ja'Marr Chase"), 'J.Chase')
        self.assertEqual(auto.short_name('Amon-Ra St. Brown'), 'A.St. Brown')
        self.assertEqual(auto.short_name('Cher'), 'Cher')


class LogoTests(unittest.TestCase):
    def test_logos_come_from_nflverse_with_the_rams_as_lar(self):
        teams = [
            {'team_abbr': 'LA', 'team_logo_squared': 'https://example.test/LA.png'},
            {'team_abbr': 'LAR', 'team_logo_squared': 'https://example.test/LAR.png'},
            {'team_abbr': 'OAK', 'team_logo_squared': 'https://example.test/OAK.png'},
            {'team_abbr': 'BUF', 'team_logo_squared': 'https://example.test/BUF.png'},
        ]
        self.assertEqual(logo_urls(teams), {'LAR': 'https://example.test/LA.png', 'BUF': 'https://example.test/BUF.png'})

    def test_every_team_has_a_logo_file(self):
        import json

        root = Path(__file__).resolve().parent.parent
        teams = {t['abbr'] for t in json.loads((root / 'src' / 'data' / 'teams.json').read_text())}
        logos = {p.stem for p in (root / 'public' / 'logos').glob('*.png')}
        self.assertEqual(teams, logos)


@unittest.skipUnless(HAS_MATPLOTLIB, 'matplotlib not installed')
class RenderTests(unittest.TestCase):
    """End to end through matplotlib: what a real chart script produces."""

    def draw(self, slug='render-test'):
        fig, ax = style.figure()
        ax.plot([1, 2, 3], [1, 3, 2])
        style.team_logo(ax, 'BUF', 2, 3)
        style.label_ends(ax, 3, [(2, 'J.Allen', style.SERIES[0], 'BUF'), (2.05, 'J.Cook', style.SERIES[1], 'BUF')])
        return style.svg_text(fig, slug)

    def test_a_real_chart_is_inline_ready_with_logo_references(self):
        svg = self.draw()
        self.assertTrue(svg.startswith('<svg class="chart-svg chart-render-test"'))
        self.assertEqual(svg.count('href="logo:BUF"'), 3)
        self.assertNotIn('base64', svg)
        logos = [tag for tag in svg.split('<image')[1:]]
        self.assertTrue(all('transform' not in tag.split('>', 1)[0] for tag in logos), 'a logo is still flipped')
        self.assertNotIn('DejaVu', svg)

    def test_redrawing_the_same_chart_gives_the_same_file(self):
        self.assertEqual(self.draw(), self.draw())

    def test_save_writes_only_when_something_changed(self):
        with tempfile.TemporaryDirectory() as tmp:
            fig, ax = style.figure()
            ax.plot([1, 2])
            path = style.save(fig, 'same', Path(tmp))
            first = path.stat().st_mtime_ns
            fig, ax = style.figure()
            ax.plot([1, 2])
            style.save(fig, 'same', Path(tmp))
            self.assertEqual(path.stat().st_mtime_ns, first)


if __name__ == '__main__':
    unittest.main()
