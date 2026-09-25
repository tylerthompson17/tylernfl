"""Tests for the chart pipeline: the shared style module, the auto chart
templates, and the logo download. Run with the other pipeline tests:
    python -m unittest discover -s pipelines
"""

import importlib.util
import tempfile
import unittest
from datetime import date
from pathlib import Path

from build_logos import LOGO_COLUMN, logo_urls
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
    return {'game_id': f'2026_02_{away}_{home}', 'season': 2026, 'week': 2, 'gameday': day, 'gametime': gametime,
            'away_team': away, 'home_team': home, 'away_score': away_score, 'home_score': home_score, **extra}


def wp_play(qtr, remaining, wp):
    """A play carrying a win probability, for the picking tests. The
    hover tests below use their own play(), which also carries an id."""
    return {'qtr': qtr, 'game_seconds_remaining': remaining, 'home_wp': wp, 'home_wp_post': wp}


def decided_late(wp=0.99):
    """A game put away early: wild in the first half, over by the fourth."""
    return [wp_play(1, 3000, 0.5), wp_play(2, 2000, 0.1), wp_play(2, 1900, 0.8), wp_play(4, 200, wp), wp_play(4, 60, wp)]


def close_late():
    """A game still on a knife edge at the end."""
    return [wp_play(1, 3000, 0.5), wp_play(4, 240, 0.52), wp_play(4, 120, 0.48), wp_play(4, 20, 0.5)]


class PickingTests(unittest.TestCase):
    def test_finals_on_takes_that_day_s_finished_games(self):
        rows = [game('A', 'B', 20, 17), game('C', 'D', None, None), game('E', 'F', 10, 13, day='2026-09-19')]
        self.assertEqual([r['away_team'] for r in auto.finals_on(rows, date(2026, 9, 20))], ['A'])
        self.assertEqual(auto.finals_on(rows, date(2026, 9, 18)), [])

    def test_late_doubt_reads_the_end_of_the_game_only(self):
        # The three plays inside five minutes: 52%, 48% and even.
        self.assertAlmostEqual(auto.late_doubt(close_late()), (0.96 + 0.96 + 1.0) / 3)
        self.assertLess(auto.late_doubt(decided_late()), 0.05)

    def test_all_of_overtime_counts_as_late(self):
        # Overtime's clock counts down from 10:00 again, so its plays are
        # late whatever game_seconds_remaining says.
        self.assertEqual(auto.late_doubt([wp_play(5, 600, 0.5)]), 1.0)

    def test_collapse_is_the_lead_handed_back(self):
        blown = [wp_play(3, 1200, 0.95), wp_play(4, 300, 0.4), wp_play(4, 10, 0.2)]
        self.assertAlmostEqual(auto.collapse(blown), 0.9)
        # The road team can be the one that lets it go.
        self.assertAlmostEqual(auto.collapse([wp_play(3, 1200, 0.05), wp_play(4, 10, 0.6)]), 0.9)

    def test_a_lead_that_was_never_handed_back_is_no_collapse(self):
        self.assertEqual(auto.collapse([wp_play(1, 3000, 0.55), wp_play(2, 1800, 0.8), wp_play(4, 10, 0.99)]), 0.0)

    def test_the_best_game_is_the_one_still_in_doubt_late(self):
        games = [(game('A', 'B', 20, 17, '13:00'), decided_late()),
                 (game('C', 'D', 41, 10, '16:25'), close_late())]
        picked, _ = auto.best_game(games, auto.GAME_SCORE(games))
        self.assertEqual(picked['away_team'], 'C')

    def test_a_blown_lead_beats_a_quiet_close_game(self):
        quiet = [wp_play(1, 3000, 0.6), wp_play(3, 1200, 0.72), wp_play(4, 200, 0.62), wp_play(4, 10, 0.58)]
        choke = [wp_play(1, 3000, 0.5), wp_play(3, 1200, 0.93), wp_play(4, 200, 0.5), wp_play(4, 10, 0.45)]
        games = [(game('A', 'B', 20, 17, '13:00'), quiet), (game('C', 'D', 24, 21, '16:25'), choke)]
        picked, _ = auto.best_game(games, auto.GAME_SCORE(games))
        self.assertEqual(picked['away_team'], 'C')

    def test_equal_games_go_to_the_later_kickoff(self):
        games = [(game('A', 'B', 20, 17, '13:00'), close_late()),
                 (game('C', 'D', 24, 21, '20:20'), close_late()),
                 (game('E', 'F', 10, 13, '16:25'), close_late())]
        picked, _ = auto.best_game(games, auto.GAME_SCORE(games))
        self.assertEqual(picked['away_team'], 'C')

    def test_no_candidates_means_no_game(self):
        self.assertIsNone(auto.best_game([], {}))

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


def moment(play_id, qtr, remaining, before, after, **fields):
    return {'play_id': play_id, 'qtr': qtr, 'game_seconds_remaining': remaining,
            'home_wp': before, 'home_wp_post': after, **fields}


class WinProbabilityLineTests(unittest.TestCase):
    def test_nflverse_quarters_are_floats_and_read_as_whole_quarters(self):
        self.assertEqual(auto.clock_label(4.0, 130.0), 'Q4 2:10')
        self.assertEqual(auto.clock_label(5.0, 313.0), 'OT 5:13')

    def test_the_line_shows_each_play_where_it_happened(self):
        plays = [moment(1, 1, 3600, 0.50, 0.52), moment(2, 2, 2400, 0.52, 0.80), moment(3, 4, 10, 0.80, None)]
        points = auto.wp_points(plays, 20, 24)
        self.assertEqual(points[0], (0.0, 0.50))
        self.assertEqual(points[2], (20.0, 0.80))
        self.assertEqual(points[3][1], 0.80)  # no after value: the before value stands


class DescribePlayTests(unittest.TestCase):
    def says(self, expected, **fields):
        self.assertEqual(auto.describe_play(fields), expected)

    def test_scoring_and_kicking(self):
        self.says('H.Butker 31 yd FG', play_type='field_goal', field_goal_result='made', kick_distance=31.0, kicker_player_name='H.Butker')
        self.says('J.Bates 52 yd FG missed', play_type='field_goal', field_goal_result='missed', kick_distance=52.0, kicker_player_name='J.Bates')
        self.says('P.Mahomes to R.Rice, 31 yd TD', play_type='pass', touchdown=1.0, yards_gained=31.0,
                  passer_player_name='P.Mahomes', receiver_player_name='R.Rice', complete_pass=1.0)
        self.says('K.Walker 12 yd TD run', play_type='run', touchdown=1.0, yards_gained=12.0, rusher_player_name='K.Walker')
        self.says('Return TD', play_type='kickoff', return_touchdown=1.0)
        self.says('Safety', play_type='run', safety=1.0, rusher_player_name='J.Cook')

    def test_turnovers_and_stops(self):
        self.says('D.Jones intercepted by K.Fulton', play_type='pass', interception=1.0,
                  passer_player_name='D.Jones', interception_player_name='K.Fulton')
        self.says('Fumble lost, J.Cook', play_type='run', fumble_lost=1.0, fumbled_1_player_name='J.Cook',
                  rusher_player_name='J.Cook')
        self.says('J.Allen sacked', play_type='pass', sack=1.0, passer_player_name='J.Allen')
        self.says('Stopped on 4th and 2', play_type='run', fourth_down_failed=1.0, ydstogo=2.0,
                  rusher_player_name='J.Cook', yards_gained=1.0)

    def test_ordinary_plays(self):
        self.says('P.Mahomes to T.Thornton, 45 yds', play_type='pass', yards_gained=45.0,
                  passer_player_name='P.Mahomes', receiver_player_name='T.Thornton', complete_pass=1.0)
        self.says('P.Mahomes incomplete', play_type='pass', yards_gained=0.0, passer_player_name='P.Mahomes',
                  receiver_player_name='K.Walker', complete_pass=0.0)
        self.says('K.Walker 8 yd run', play_type='run', yards_gained=8.0, rusher_player_name='K.Walker')
        self.says('Punt', play_type='punt')
        self.says('Penalty, Defensive Pass Interference', play_type='no_play', penalty=1.0,
                  penalty_type='Defensive Pass Interference')
        self.says('Qb kneel', play_type='qb_kneel')


class CalloutTests(unittest.TestCase):
    def test_callouts_line_up_with_their_point_near_the_ends(self):
        self.assertEqual(style.callout_align(0.1), 0.0)
        self.assertEqual(style.callout_align(0.5), 0.5)
        self.assertEqual(style.callout_align(0.95), 1.0)


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
        # Whichever column LOGO_COLUMN names: the rule under test is that
        # nflverse's LA row becomes LAR and defunct teams are left out.
        teams = [
            {'team_abbr': abbr, LOGO_COLUMN: f'https://example.test/{abbr}.png'}
            for abbr in ('LA', 'LAR', 'OAK', 'BUF')
        ]
        self.assertEqual(logo_urls(teams), {'LAR': 'https://example.test/LA.png', 'BUF': 'https://example.test/BUF.png'})

    def test_the_logo_column_is_one_with_transparent_ground(self):
        # The squared logos are each logo on an opaque square of the team's
        # colour, which reads as a tile on a chart, not a team.
        self.assertNotEqual(LOGO_COLUMN, 'team_logo_squared')

    @unittest.skipUnless(HAS_MATPLOTLIB, 'Pillow comes with matplotlib')
    def test_no_logo_file_is_a_solid_block(self):
        from PIL import Image

        root = Path(__file__).resolve().parent.parent
        opaque = []
        for path in sorted((root / 'public' / 'logos').glob('*.png')):
            if Image.open(path).convert('RGBA').getchannel('A').getextrema()[0] == 255:
                opaque.append(path.stem)
        self.assertEqual(opaque, [], 'logos with no transparent pixel: run build_logos.py')

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

    def test_a_callout_draws_one_boxed_label_with_both_lines(self):
        fig, ax = style.figure()
        ax.plot([0, 30, 60], [0.5, 0.8, 0.4])
        ax.set_xlim(0, 60)
        ax.set_ylim(0, 1)
        style.callout(ax, 30, 0.8, ['Q3 0:00, KC +22%', 'P.Mahomes to T.Thornton, 45 yds'], label_y=0.03)
        svg = style.svg_text(fig, 'callout-test')
        self.assertIn('Q3 0:00, KC +22%', svg)
        self.assertIn('P.Mahomes to T.Thornton, 45 yds', svg)

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



@unittest.skipUnless(HAS_MATPLOTLIB, 'matplotlib not installed')
class ArchiveTests(unittest.TestCase):
    """Every auto chart is kept under its own slug for the gallery."""

    def chart(self, slug, day, note='A note.'):
        fig, ax = style.figure()
        ax.plot([1, 2])
        meta = {'template': 'epa', 'title': 'Offense and defense, EPA per play', 'note': note,
                'asOf': '2026 season, through week 2', 'source': 'nflverse', 'date': day,
                'tags': ['Auto', 'EPA'], 'pick': True}
        return meta, fig, slug, None

    def write(self, chart, tmp):
        import common
        from unittest import mock
        with mock.patch.object(common, 'DATA_DIR', tmp), mock.patch.object(auto, 'DATA_DIR', tmp):
            return auto.write_charts([chart], chart[2])[1] > 0

    def read(self, tmp, name):
        import json
        return json.loads((tmp / 'charts' / name).read_text())

    def test_each_chart_is_kept_and_auto_json_names_the_latest(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            self.assertTrue(self.write(self.chart('auto-2026-week-1-offense-defense-epa', '2026-09-15'), tmp))
            self.assertTrue(self.write(self.chart('auto-2026-week-2-offense-defense-epa', '2026-09-22'), tmp))
            archive = sorted(p.name for p in (tmp / 'charts' / 'archive').iterdir())
            self.assertEqual(archive, ['auto-2026-week-1-offense-defense-epa.json', 'auto-2026-week-1-offense-defense-epa.svg',
                                       'auto-2026-week-2-offense-defense-epa.json', 'auto-2026-week-2-offense-defense-epa.svg'])
            self.assertEqual(self.read(tmp, 'auto.json'), {'slug': 'auto-2026-week-2-offense-defense-epa'})

    def test_a_rams_game_is_drawn_as_lar(self):
        from unittest import mock
        game = {'game_id': '2026_02_DET_LA', 'season': 2026, 'week': 2, 'gameday': '2026-09-21',
                'away_team': 'DET', 'home_team': 'LA', 'away_score': 20, 'home_score': 23}
        seen = {}
        def draw(g, points, plays):
            seen.update(g)
            return None, None
        with mock.patch.object(auto, 'draw_wp', draw):
            meta, _, slug, _ = auto._wp_chart(game, [moment(1, 1, 3600, 0.5, 0.55)])
        self.assertEqual(seen['home_team'], 'LAR')
        self.assertEqual(meta['title'], 'Win probability, DET at LAR')
        self.assertEqual(meta['teams'], ['DET', 'LAR'])
        self.assertEqual(slug, 'auto-2026-week-2-det-at-lar-win-probability')
        self.assertEqual(auto.wp_slug(game), slug)

    def test_a_redraw_keeps_the_first_date_and_a_rerun_changes_nothing(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            slug = 'auto-2026-week-2-offense-defense-epa'
            self.write(self.chart(slug, '2026-09-22'), tmp)
            self.assertFalse(self.write(self.chart(slug, '2026-09-22'), tmp))
            self.assertTrue(self.write(self.chart(slug, '2026-09-24', note='Corrected.'), tmp))
            entry = self.read(tmp, f'archive/{slug}.json')
            self.assertEqual((entry['date'], entry['note']), ('2026-09-22', 'Corrected.'))


@unittest.skipUnless(importlib.util.find_spec('polars'), 'polars not installed')
class EveryGameTests(unittest.TestCase):
    """Every final gets a win probability chart; one a day is the pick."""

    # A thriller, a game decided early, a blowout, and the next day's game.
    GAMES = [
        (game('IND', 'KC', 30, 33, '20:20'), [(1, 1, 3600, 0.5, 0.5), (2, 4, 60, 0.48, 0.52)]),
        (game('GB', 'NYJ', 20, 17, '13:00'), [(1, 1, 3600, 0.5, 0.5), (2, 4, 60, 0.95, 0.97)]),
        (game('CAR', 'ATL', 34, 3, '13:00'), [(1, 1, 3600, 0.5, 0.6), (2, 4, 60, 0.99, 0.99)]),
        (game('NYG', 'LAR', 6, 28, day='2026-09-21'), [(1, 1, 3600, 0.5, 0.6), (2, 4, 60, 0.98, 0.99)]),
    ]

    def build(self, tmp, today=date(2026, 9, 21)):
        from unittest import mock
        import polars as pl
        plays = [moment(pid, qtr, left, before, after, game_id=g['game_id'])
                 for g, moments in self.GAMES for pid, qtr, left, before, after in moments]
        with mock.patch('pbp_cache.load_pbp', return_value=pl.DataFrame(plays)), \
             mock.patch.object(auto, 'draw_wp', lambda *a: (None, None)), \
             mock.patch.object(auto, 'DATA_DIR', tmp):
            charts, pick = auto.build_auto_charts(today, [g for g, _ in self.GAMES], 2026)
            return [(slug, meta['pick']) for meta, _, slug, _ in charts], pick

    def test_every_final_is_drawn_and_the_best_of_yesterday_is_the_pick(self):
        with tempfile.TemporaryDirectory() as tmp:
            drawn, pick = self.build(Path(tmp))
        # Kickoff order, the afternoon games before the night game.
        self.assertEqual([slug for slug, _ in drawn], [
            'auto-2026-week-2-gb-at-nyj-win-probability',
            'auto-2026-week-2-car-at-atl-win-probability',
            'auto-2026-week-2-ind-at-kc-win-probability',
            'auto-2026-week-2-nyg-at-lar-win-probability',
        ])
        # Yesterday's thriller is today's chart; every other game is kept
        # for its teams' pages only.
        self.assertEqual(pick, 'auto-2026-week-2-ind-at-kc-win-probability')
        self.assertEqual([slug for slug, is_pick in drawn if is_pick], [pick])

    def test_a_game_already_in_the_archive_is_not_drawn_again(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            archive = tmp / 'charts' / 'archive'
            archive.mkdir(parents=True)
            for name in ('auto-2026-week-2-ind-at-kc-win-probability', 'auto-2026-week-2-car-at-atl-win-probability'):
                (archive / f'{name}.json').write_text('{}')
                (archive / f'{name}.hover.json').write_text('{}')
            drawn, pick = self.build(tmp)
        self.assertEqual([slug for slug, _ in drawn], [
            'auto-2026-week-2-gb-at-nyj-win-probability',
            'auto-2026-week-2-nyg-at-lar-win-probability',
        ])
        # Still today's chart, drawn or not: auto.json points at it either way.
        self.assertEqual(pick, 'auto-2026-week-2-ind-at-kc-win-probability')


class HoverTests(unittest.TestCase):
    def test_marker_rows_and_unnamed_stoppages_are_left_out_timeouts_named(self):
        plays = [
            {'play_id': 1, 'qtr': 1, 'game_seconds_remaining': 3600, 'home_wp': 0.55, 'home_wp_post': 0.55, 'play_type': None},
            {'play_id': 2, 'qtr': 1, 'game_seconds_remaining': 3600, 'home_wp': 0.55, 'home_wp_post': 0.56, 'play_type': 'kickoff'},
            {'play_id': 3, 'qtr': 1, 'game_seconds_remaining': 3000, 'home_wp': 0.56, 'home_wp_post': 0.56, 'play_type': 'no_play',
             'timeout': 1.0, 'timeout_team': 'LA'},
            {'play_id': 4, 'qtr': 1, 'game_seconds_remaining': 2990, 'home_wp': 0.56, 'home_wp_post': 0.56, 'play_type': 'no_play'},
            {'play_id': 5, 'qtr': 4, 'game_seconds_remaining': 130, 'home_wp': 0.40, 'home_wp_post': 0.62, 'play_type': 'pass',
             'passer_player_name': 'P.Mahomes', 'receiver_player_name': 'T.Thornton', 'yards_gained': 45.0, 'complete_pass': 1.0},
        ]
        game = {'away_team': 'IND', 'home_team': 'KC', 'away_score': 30, 'home_score': 33, 'overtime': 1}
        points = auto.wp_hover(game, plays, ax=None)['points']
        self.assertEqual([p['lines'] for p in points], [
            ['Kickoff · KC 55%'],
            ['Q1 15:00 · KC 56%', 'Kickoff', 'KC +1% on the play'],
            ['Q1 5:00 · KC 56%', 'Timeout, LAR'],
            ['Q4 2:10 · KC 62%', 'P.Mahomes to T.Thornton, 45 yds', 'KC +22% on the play'],
            ['Final · KC beat IND 33 to 30 in overtime'],
        ])
        self.assertEqual(points[-1]['y'], 1.0)

    def test_every_readout_carries_the_score(self):
        plays = [
            {'play_id': 1, 'qtr': 1, 'game_seconds_remaining': 3600, 'home_wp': 0.55, 'home_wp_post': 0.55,
             'play_type': 'kickoff', 'total_away_score': 0, 'total_home_score': 0},
            {'play_id': 2, 'qtr': 2, 'game_seconds_remaining': 1881, 'home_wp': 0.60, 'home_wp_post': 0.60,
             'play_type': 'no_play', 'timeout': 1.0, 'timeout_team': 'KC',
             'total_away_score': 3, 'total_home_score': 17},
        ]
        game = {'away_team': 'IND', 'home_team': 'KC', 'away_score': 30, 'home_score': 33}
        points = auto.wp_hover(game, plays, ax=None)['points']
        self.assertEqual(points[2]['lines'], ['Q2 1:21 · KC 60%', 'IND 3, KC 17', 'Timeout, KC'])

    def test_a_scoring_play_says_what_it_scored_without_repeating_it(self):
        def lines(**fields):
            play = {'play_id': 1, 'qtr': 1, 'game_seconds_remaining': 2719, 'home_wp': 0.7, 'home_wp_post': 0.7,
                    'sp': 1.0, 'total_away_score': 0, 'total_home_score': 6, **fields}
            game = {'away_team': 'NYG', 'home_team': 'LAR', 'away_score': 6, 'home_score': 28}
            return auto.wp_hover(game, [play], ax=None)['points'][1]['lines']

        self.assertEqual(
            lines(play_type='pass', passer_player_name='M.Stafford', receiver_player_name='D.Adams',
                  yards_gained=31.0, complete_pass=1.0, touchdown=1.0),
            ['Q1 0:19 · LAR 70%', 'Touchdown · NYG 0, LAR 6', 'M.Stafford to D.Adams, 31 yds'])
        self.assertEqual(
            lines(play_type='field_goal', kicker_player_name='H.Mevis', kick_distance=40.0, field_goal_result='made'),
            ['Q1 0:19 · LAR 70%', 'Field goal · NYG 0, LAR 6', 'H.Mevis from 40'])
        # An extra point is the whole story: the score line tells it.
        self.assertEqual(
            lines(play_type='extra_point', extra_point_result='good'),
            ['Q1 0:19 · LAR 70%', 'Extra point · NYG 0, LAR 6'])

    def test_a_play_that_scored_nothing_is_described_as_before(self):
        play = {'play_id': 1, 'qtr': 4, 'game_seconds_remaining': 130, 'home_wp': 0.4, 'home_wp_post': 0.62,
                'play_type': 'pass', 'passer_player_name': 'P.Mahomes', 'receiver_player_name': 'T.Thornton',
                'yards_gained': 45.0, 'complete_pass': 1.0, 'total_away_score': 30, 'total_home_score': 26}
        game = {'away_team': 'IND', 'home_team': 'KC', 'away_score': 30, 'home_score': 33}
        self.assertEqual(auto.wp_hover(game, [play], ax=None)['points'][1]['lines'], [
            'Q4 2:10 · KC 62%', 'IND 30, KC 26', 'P.Mahomes to T.Thornton, 45 yds', 'KC +22% on the play'])

    def test_a_missed_kick_is_not_a_scoring_play(self):
        missed = {'play_type': 'field_goal', 'field_goal_result': 'missed', 'kick_distance': 52.0,
                  'kicker_player_name': 'H.Mevis'}
        self.assertIsNone(auto.scoring_kind(missed))
        self.assertEqual(auto.describe_play(missed), 'H.Mevis 52 yd FG missed')

    def test_even_odds_read_as_even(self):
        self.assertEqual(auto._chance('KC', 'IND', 0.503), 'Even')
        self.assertEqual(auto._chance('KC', 'IND', 0.38), 'IND 62%')

    def test_signed_values_use_a_true_minus(self):
        self.assertEqual(auto.signed3(-0.378), '−0.378')
        self.assertEqual(auto.signed3(0.118), '+0.118')


@unittest.skipUnless(HAS_MATPLOTLIB, 'matplotlib not installed')
class HoverGeometryTests(unittest.TestCase):
    def test_the_plot_area_and_ranges_match_what_is_drawn(self):
        with tempfile.TemporaryDirectory() as tmp:
            fig, ax = style.figure()
            ax.plot([0, 60], [0, 1])
            ax.set_xlim(0, 60)
            ax.set_ylim(1, 0)  # inverted, as the EPA chart's is
            style.save(fig, 'geo', Path(tmp), hover={'ax': ax, 'mode': 'x', 'points': [
                {'x': 30, 'y': 0.5, 'lines': ['Middle']}]})
            import json
            data = json.loads((Path(tmp) / 'geo.hover.json').read_text())
            self.assertEqual(data['xRange'], [0.0, 60.0])
            self.assertEqual(data['yRange'], [1.0, 0.0])
            plot = data['plot']
            self.assertTrue(0 < plot['x'] < 100 and 0 <= plot['y'] < 50)
            self.assertTrue(plot['x'] + plot['width'] <= style.WIDTH_PX)
            self.assertTrue(plot['y'] + plot['height'] <= style.HEIGHT_PX)
            self.assertEqual(data['points'], [{'x': 30.0, 'y': 0.5, 'lines': ['Middle']}])

    def test_saving_without_hover_removes_an_old_hover_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / 'old.hover.json').write_text('{}')
            fig, ax = style.figure()
            ax.plot([1, 2])
            style.save(fig, 'old', Path(tmp))
            self.assertFalse((Path(tmp) / 'old.hover.json').exists())


if __name__ == '__main__':
    unittest.main()
