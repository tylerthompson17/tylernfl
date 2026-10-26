"""Tests for the Retro Replays scenes (replays.py), on small made-up plays in
the NGS highlights' row format. Run with the other pipeline tests:
    python -m unittest discover -s pipelines
"""

import unittest

import replays

GAME = {
    'gameId': '2018092311', 'playId': '141', 'playType': 'play_type_pass', 'season': '2018',
    'seasonType': 'REG', 'week': '3', 'preSnapHomeScore': '0', 'preSnapVisitorScore': '0',
    'playDirection': 'right', 'quarter': '1', 'gameClock': '12:20', 'down': '2', 'yardsToGo': '6',
    'yardline': 'CHI 35', 'absoluteYardlineNumber': '75', 'playDescription': 'NGS text',
}
ROSTER = {
    'qb': ('ARI', 'QB', 9),
    'rb': ('ARI', 'RB', 31),
    'wr': ('ARI', 'WR', 14),
    'cb': ('CHI', 'CB', 24),
}


def row(frame, who, x, y, s=0.0, event='', **game):
    """One tracking row; who is 'ball' or a ROSTER key."""
    base = {**GAME, **game, 'frame': str(frame), 'event': event, 'x': str(x), 'y': str(y), 's': str(s)}
    if who == 'ball':
        return {**base, 'displayName': 'ball', 'nflId': '', 'teamAbbr': '', 'position': '', 'jerseyNumber': '',
                'possessionFlag': '', 'homeTeamFlag': '', 'o': '', 'dir': ''}
    team, position, jersey = ROSTER[who]
    return {**base, 'displayName': who.upper(), 'nflId': who, 'teamAbbr': team, 'position': position,
            'jerseyNumber': f'{jersey}.0', 'possessionFlag': '1.0' if team == 'ARI' else '0.0',
            'homeTeamFlag': '1.0' if team == 'ARI' else '0.0', 'o': '80', 'dir': '90'}


def play(frames, events=None, **game):
    """Rows from {frame: {who: (x, y, s)}}; every frame needs a 'ball'."""
    events = events or {}
    rows = []
    for frame, spots in frames.items():
        for who, spot in spots.items():
            rows.append(row(frame, who, *spot, event=events.get(frame, ''), **game))
    return rows


def pass_play():
    """QB takes the snap at frame 2, throws at 4, WR catches at 7 and runs
    out of bounds at 10. The ball is on the WR from 7."""
    frames = {}
    for f in range(13):
        wr = (75 + f * 2.0, 20.0, 8.0)
        if f < 4:
            ball = (75.0, 25.0, 0.0)
        elif f < 7:
            ball = (75 + (f - 3) * 7.0, 23.0, 20.0)
        else:
            ball = (wr[0], wr[1] + 0.5, 8.0)
        frames[f] = {'ball': ball, 'qb': (74.0, 25.0, 1.0), 'wr': wr, 'cb': (wr[0] + 3, 21.0, 7.0),
                     'rb': (72.0, 27.0, 1.0)}
    events = {2: 'ball_snap', 4: 'pass_forward', 7: 'pass_outcome_caught', 10: 'out_of_bounds'}
    return play(frames, events)


class AngleAndSideTests(unittest.TestCase):
    def test_flip_turns_the_field_round(self):
        self.assertEqual(replays.flip_xy(45.0, 23.7), (75.0, 53.3 - 23.7))
        self.assertEqual(replays.flip_angle(10.0), 190.0)
        self.assertEqual(replays.flip_angle(350.0), 170.0)

    def test_win_probability_from_either_side(self):
        # DAL's two point try at NYJ, 2019 week 6: home_wp 0.802, DAL's wp 0.198.
        self.assertEqual(replays.team_wp(0.8023656890392303, 'DAL', 'NYJ'), 0.198)
        self.assertEqual(replays.team_wp(0.6205621957778931, 'ARI', 'ARI'), 0.621)
        self.assertIsNone(replays.team_wp(None, 'ARI', 'ARI'))
        self.assertIsNone(replays.team_wp(float('nan'), 'ARI', 'CHI'))

    def test_the_featured_team_is_the_one_whose_win_probability_rose(self):
        self.assertEqual(replays.featured_team('SF', 'SEA', 0.11, 0.61, 'SEA'), 'SF')  # SEA threw the pick
        self.assertEqual(replays.featured_team('SF', 'SEA', 0.61, 0.11, 'SEA'), 'SEA')
        self.assertEqual(replays.featured_team('SF', 'SEA', 0.5, 0.5, 'SEA'), 'SEA')  # no change: the fallback
        self.assertEqual(replays.featured_team('SF', 'SEA', None, 0.5, 'SEA'), 'SEA')
        self.assertEqual(replays.featured_team('SF', 'SEA', float('nan'), 0.5, 'SF'), 'SF')

    def test_rounding(self):
        self.assertEqual(replays.tenths(52.33), 523)
        self.assertIsNone(replays.tenths(None))
        self.assertEqual(replays.degrees(359.7), 0)


class FrameTests(unittest.TestCase):
    def test_repeated_rows_and_frames_without_a_ball_are_dropped(self):
        rows = play({0: {'ball': (1, 1, 0), 'qb': (2, 2, 0)}, 1: {'qb': (3, 3, 0)}})
        rows.append(row(0, 'qb', 9, 9))
        players, ball, frames = replays.frames_of(rows)
        self.assertEqual(frames, [0])
        self.assertEqual(players['qb'][0]['x'], '2')
        self.assertEqual(set(players['qb']), {0, 1})

    def test_flights_run_from_the_throw_to_its_first_end(self):
        events = [(4, 'pass_forward'), (6, 'pass_arrived'), (7, 'pass_outcome_caught')]
        self.assertEqual(replays.flights_of(events), [{'kind': 'pass', 'from': 4, 'to': 6}])
        kick = [(1, 'kickoff_play'), (12, 'kickoff'), (48, 'kick_received'), (90, 'out_of_bounds')]
        self.assertEqual(replays.flights_of(kick), [{'kind': 'kick', 'from': 12, 'to': 48}])


class CarrierTests(unittest.TestCase):
    def carriers(self, rows, play_type='pass'):
        players, ball, frames = replays.frames_of(rows)
        events = replays.events_of(rows)
        return replays.carriers_of(players, ball, frames, events, 'ARI', play_type)

    def test_quarterback_holds_it_from_the_snap_to_the_throw(self):
        carriers = self.carriers(pass_play())
        self.assertEqual([carriers[f] for f in range(4)], [None, None, 'qb', 'qb'])

    def test_nobody_has_it_in_the_air_and_the_catcher_takes_it_at_once(self):
        carriers = self.carriers(pass_play())
        self.assertEqual([carriers[f] for f in (4, 5, 6)], [None, None, None])
        self.assertEqual(carriers[7], 'wr')

    def test_a_handoff_goes_to_the_back_at_once(self):
        frames = {}
        for f in range(10):
            ball = (74.0, 25.0, 0) if f < 4 else (72.0, 27.0, 0)  # on the QB, then on the RB from 4
            frames[f] = {'ball': ball, 'qb': (74.0, 25.0, 0), 'rb': (72.0, 27.0, 0)}
        carriers = self.carriers(play(frames, {1: 'ball_snap', 3: 'handoff'}), 'rush')
        self.assertEqual([carriers[f] for f in (2, 3)], ['qb', 'qb'])  # pinned; still in his hands at the handoff
        self.assertEqual(carriers[4], 'rb')  # the first frame it is on the back, not three later

    def test_a_new_carrier_needs_three_frames_in_a_row(self):
        # The RB has it; a defender is nearest the ball for two frames (a
        # pileup), then for three.
        frames = {}
        for f in range(16):
            if f < 6 or 8 <= f < 10:
                ball = (72.0, 27.0, 0)  # on the RB
            else:
                ball = (76.0, 30.0, 0)  # on the CB: frames 6 and 7, then from 10
            frames[f] = {'ball': ball, 'qb': (74.0, 25.0, 0), 'rb': (72.0, 27.0, 0), 'cb': (76.0, 30.0, 0)}
        carriers = self.carriers(play(frames, {1: 'ball_snap', 3: 'handoff'}), 'rush')
        self.assertEqual([carriers[f] for f in range(4, 10)], ['rb'] * 6)  # two frames: no switch
        self.assertEqual([carriers[f] for f in (10, 11, 12)], ['rb', 'rb', 'cb'])

    def lateral_play(self):
        """The WR catches a pass at 4, laterals at 8; the ball is in the air
        for three frames and reaches the RB at 11."""
        frames = {}
        for f in range(16):
            wr = (80.0 + min(f, 8) * 0.5, 20.0, 5.0)
            rb = (82.0, 16.0 + min(f, 11) * 0.0, 5.0)
            if f < 2:
                ball = (75.0, 25.0, 0.0)
            elif f < 4:
                ball = (75.0 + (f - 1) * 2.0, 23.0, 20.0)
            elif f < 8:
                ball = (wr[0], wr[1] + 0.3, 5.0)
            elif f < 11:
                ball = (wr[0] + (f - 8) * 0.3, 20.0 - (f - 7) * 1.0, 10.0)  # tossed toward the RB
            else:
                ball = (rb[0], rb[1] + 0.3, 5.0)
            frames[f] = {'ball': ball, 'qb': (74.0, 25.0, 1.0), 'wr': wr, 'rb': rb, 'cb': (90.0, 30.0, 3.0)}
        return play(frames, {1: 'ball_snap', 2: 'pass_forward', 4: 'pass_outcome_caught', 8: 'lateral'})

    def test_a_lateral_is_a_flight_to_whoever_catches_it(self):
        rows = self.lateral_play()
        players, ball, frames = replays.frames_of(rows)
        events = replays.events_of(rows)
        self.assertEqual(replays.lateral_flights(events, players, ball, frames), [{'kind': 'lateral', 'from': 8, 'to': 11}])
        carriers = self.carriers(rows)
        self.assertEqual(carriers[7], 'wr')
        self.assertEqual([carriers[f] for f in (8, 9, 10)], [None] * 3)  # in the air: nobody
        self.assertEqual(carriers[11], 'rb')  # caught: at once

    def test_a_direct_snap_goes_to_whoever_takes_it(self):
        # The RB stands over the ball as the center; it is snapped direct at
        # 2 and reaches the WR (not the QB) at 4.
        frames = {}
        for f in range(10):
            ball = (75.0, 25.0, 0) if f <= 2 else ((76.5, 23.5, 0) if f == 3 else (78.0, 22.0, 4.0))
            frames[f] = {'ball': ball, 'rb': (75.0, 25.2, 0), 'qb': (74.0, 28.0, 0), 'wr': (78.0, 22.0, 4.0)}
        rows = play(frames, {2: 'snap_direct'}, playType='play_type_rush')
        players, ball, frames_ = replays.frames_of(rows)
        events = replays.events_of(rows)
        self.assertEqual(replays.all_flights(events, players, ball, frames_), [{'kind': 'snap', 'from': 2, 'to': 4}])
        carriers = self.carriers(rows, 'rush')
        self.assertEqual([carriers[f] for f in (1, 2, 3)], [None, None, None])  # not the QB, not the center
        self.assertEqual(carriers[4], 'wr')

    def test_a_lateral_nobody_catches_is_not_a_flight(self):
        rows = [r for r in self.lateral_play() if not (r['displayName'] == 'RB')]
        players, ball, frames = replays.frames_of(rows)
        self.assertEqual(replays.lateral_flights(replays.events_of(rows), players, ball, frames), [])

    def test_an_incompletion_leaves_nobody_with_it(self):
        frames = {f: {'ball': (75.0 + f, 25.0, 0), 'qb': (74.0, 25.0, 0), 'wr': (80.0, 25.0, 0)} for f in range(10)}
        carriers = self.carriers(play(frames, {1: 'ball_snap', 3: 'pass_forward', 6: 'pass_outcome_incomplete'}))
        self.assertEqual([carriers[f] for f in range(6, 10)], [None] * 4)


class EndTests(unittest.TestCase):
    def test_a_terminal_event_ends_it_after_the_tail(self):
        events = [(20, 'ball_snap'), (40, 'tackle')]
        frames = list(range(100))
        self.assertEqual(replays.end_frame(events, frames, 20, {}, {}), 40 + replays.TAIL_FRAMES)
        self.assertEqual(replays.end_frame(events, list(range(45)), 20, {}, {}), 44)

    def test_without_one_it_ends_a_second_after_the_carrier_slows_after_contact(self):
        speeds = {f: 6.0 if f < 33 else 0.8 for f in range(60)}
        players = {'rb': {f: {'s': str(s)} for f, s in speeds.items()}}
        carriers = {f: 'rb' for f in range(60)}
        events = [(20, 'ball_snap'), (30, 'first_contact')]
        end = replays.end_frame(events, list(range(60)), 20, carriers, players)
        self.assertEqual(end, 33 + replays.STOP_TAIL)

    def test_failing_both_it_is_the_last_frame(self):
        self.assertEqual(replays.end_frame([(20, 'ball_snap')], list(range(50)), 20, {}, {}), 49)


class SceneTests(unittest.TestCase):
    COLORS = {'ARI': {'primary': '#97233f', 'secondary': '#000000'},
              'CHI': {'primary': '#0b162a', 'secondary': '#c83803'}}
    PBP = {'game_id': '2018_03_CHI_ARI', 'game_date': '2018-09-23', 'home_team': 'ARI', 'desc': 'nflverse text',
           'total_home_score': 6.0, 'total_away_score': 0.0, 'home_wp': 0.62, 'home_wp_post': 0.697,
           'down': 2.0, 'ydstogo': 6.0}

    def test_a_play_going_left_is_turned_round(self):
        rows = [dict(r, playDirection='left', absoluteYardlineNumber='45') for r in pass_play()]
        rows = [dict(r, x=str(120 - float(r['x'])), y=str(53.3 - float(r['y']))) for r in rows]
        scene = replays.build_scene('2018_ARI_2018092311_141', rows, self.PBP, self.COLORS)
        self.assertEqual(scene['field'], {'lineOfScrimmage': 75.0, 'firstDown': 81.0, 'attack': 1})
        self.assertEqual(scene['ball']['x'][0], 750)
        self.assertEqual(scene['ball']['y'][0], 250)
        self.assertEqual(scene['players'][0]['dir'][0], 270)

    def test_scene_layout(self):
        scene = replays.build_scene('2018_ARI_2018092311_141', pass_play(), self.PBP, self.COLORS)
        self.assertEqual(scene['frameCount'], 13)  # snap at 2, under LEAD_FRAMES from frame 0
        self.assertEqual([p['side'] for p in scene['players']], ['featured'] * 3 + ['opponent'])
        self.assertEqual(scene['teams']['featured'], {'abbr': 'ARI', 'primary': '#97233f', 'secondary': '#000000'})
        self.assertEqual(scene['flights'], [{'kind': 'pass', 'from': 4, 'to': 7}])
        slots = {p['id']: i for i, p in enumerate(scene['players'])}
        self.assertEqual(scene['carrier'][2], slots['qb'])
        self.assertEqual(scene['carrier'][7], slots['wr'])
        self.assertIsNone(scene['carrier'][5])
        play = scene['play']
        self.assertEqual((play['wpBefore'], play['wpAfter']), (0.62, 0.697))
        self.assertEqual(play['scoreAfter'], {'home': 6, 'away': 0})
        self.assertEqual((play['featured'], play['opponent'], play['possession']), ('ARI', 'CHI', 'ARI'))
        self.assertEqual((play['home'], play['away'], play['penalty']), ('ARI', 'CHI', None))

    def test_a_pick_six_is_seen_from_the_defense(self):
        # ARI (home) snaps going right; the pass is intercepted and CHI's win
        # probability rises (ARI's 0.62 to 0.40): CHI is featured and moves
        # left to right, so ARI, which snapped, now goes right to left.
        pbp = {**self.PBP, 'home_wp_post': 0.40}
        scene = replays.build_scene('2018_CHI_2018092311_141', pass_play(), pbp, self.COLORS)
        play = scene['play']
        self.assertEqual((play['featured'], play['opponent'], play['possession']), ('CHI', 'ARI', 'ARI'))
        self.assertEqual((play['wpBefore'], play['wpAfter']), (0.38, 0.6))  # always a gain
        self.assertEqual(scene['field'], {'lineOfScrimmage': 45.0, 'firstDown': 39.0, 'attack': -1})
        self.assertEqual(scene['players'][0]['side'], 'featured')
        self.assertEqual(scene['players'][0]['id'], 'cb')
        self.assertEqual(scene['ball']['x'][0], 1200 - 750)  # turned round

    def test_a_penalty_comes_from_nflverse(self):
        pbp = {**self.PBP, 'penalty': 1.0, 'penalty_team': 'CHI', 'penalty_player_name': 'M.Williams',
               'penalty_yards': 14.0, 'penalty_type': 'Face Mask'}
        scene = replays.build_scene('2018_ARI_2018092311_141', pass_play(), pbp, self.COLORS)
        self.assertEqual(scene['play']['penalty'], {'team': 'CHI', 'player': 'M.Williams', 'type': 'Face Mask', 'yards': 14})
        self.assertIsNone(replays.penalty_of({**self.PBP, 'penalty': 0.0}))
        self.assertIsNone(replays.penalty_of({**self.PBP, 'penalty': float('nan')}))

    def kickoff(self, direction, pbp=None):
        """ARI (home, flagged in possession) kicks at frame 2; CHI's returner
        catches it at 6 and runs it back. By default the return helps CHI:
        ARI's win probability falls from 0.62 to 0.55."""
        frames = {}
        for f in range(12):
            if f < 2:
                ball = (65.0, 26.0, 0.0)
            elif f < 6:
                ball = (65.0 - (f - 1) * 10.0, 26.0, 25.0)
            else:
                ball = (15.0 + (f - 6) * 3.0, 26.0, 8.0)
            returner = (15.0 + max(0, f - 6) * 3.0, 26.0, 8.0)
            frames[f] = {'ball': ball, 'cb': returner, 'wr': (65.0 - f * 3.0, 20.0, 9.0)}
        rows = play(frames, {2: 'kickoff', 6: 'kick_received', 10: 'tackle'},
                    playType='play_type_kickoff', down='0', yardsToGo='0', playDirection=direction,
                    absoluteYardlineNumber='65' if direction == 'left' else '55')
        if direction == 'right':
            rows = [dict(r, x=str(120 - float(r['x'])), y=str(53.3 - float(r['y']))) for r in rows]
        pbp = pbp if pbp is not None else {**self.PBP, 'home_wp_post': 0.55}
        return replays.build_scene('2019_CHI_2019100600_1', rows, pbp, self.COLORS)

    def test_a_return_is_seen_from_the_returning_team(self):
        for direction in ('left', 'right'):
            scene = self.kickoff(direction)
            play = scene['play']
            self.assertEqual((play['featured'], play['opponent'], play['kicking']), ('CHI', 'ARI', 'ARI'))
            self.assertEqual(scene['field'], {'lineOfScrimmage': 65.0, 'firstDown': None, 'attack': -1})
            # The return runs left to right whichever way the kicking team went.
            returner = scene['players'][0]
            self.assertEqual(returner['id'], 'cb')
            self.assertLess(returner['x'][6], returner['x'][11])
            self.assertEqual(scene['flights'], [{'kind': 'kick', 'from': 2, 'to': 6}])
            self.assertEqual(scene['carrier'][7], 0)
            # ARI is home: CHI's win probability is the other side of home_wp.
            self.assertEqual((play['wpBefore'], play['wpAfter']), (0.38, 0.45))

    def test_a_kick_that_helps_the_kicking_team_is_seen_from_it(self):
        scene = self.kickoff('left', {**self.PBP, 'home_wp_post': 0.70})
        self.assertEqual((scene['play']['featured'], scene['field']['attack']), ('ARI', 1))
        self.assertEqual((scene['play']['wpBefore'], scene['play']['wpAfter']), (0.62, 0.7))

    def test_a_kick_with_no_change_falls_back_to_the_receiving_team(self):
        for pbp in ({**self.PBP, 'home_wp_post': 0.62}, {**self.PBP, 'home_wp': None, 'home_wp_post': None}):
            self.assertEqual(self.kickoff('left', pbp)['play']['featured'], 'CHI')

    def test_scenes_store_no_speed(self):
        scene = replays.build_scene('2018_ARI_2018092311_141', pass_play(), self.PBP, self.COLORS)
        self.assertEqual(set(scene['players'][0]), {'id', 'side', 'jersey', 'position', 'name', 'x', 'y', 'dir', 'o'})
        self.assertIsNone(scene['play']['kicking'])

    def test_an_oakland_play_matches_nflverses_las_vegas(self):
        rows = [dict(r, teamAbbr='OAK' if r['teamAbbr'] == 'ARI' else r['teamAbbr']) for r in pass_play()]
        scene = replays.build_scene('2018_OAK_2018092311_141', rows, {**self.PBP, 'home_team': 'LV'},
                                    {**self.COLORS, 'LV': self.COLORS['ARI']})
        self.assertEqual((scene['play']['home'], scene['teams']['featured']['abbr']), ('OAK', 'OAK'))

    def test_retired_abbreviations_keep_their_name_and_take_todays_colors(self):
        colors = {'LV': {'primary': '#000000', 'secondary': '#a5acaf'}}
        self.assertEqual(replays.team_entry('OAK', colors), {'abbr': 'OAK', 'primary': '#000000', 'secondary': '#a5acaf'})
        self.assertEqual(replays.team_entry('LA', {'LAR': colors['LV']})['abbr'], 'LAR')


class StatsTests(unittest.TestCase):
    def test_top_speed_is_the_carriers_and_air_yards_the_passes(self):
        # The QB (1 yd/s) holds it, then the WR (8 yd/s) catches it 14 yards past the line.
        self.assertEqual(replays.play_stats(pass_play()), {'snaps': 1, 'topSpeed': 16.4, 'airYards': 14})

    def test_a_play_going_left_measures_the_same(self):
        rows = [dict(r, playDirection='left', absoluteYardlineNumber='45', x=str(120 - float(r['x'])),
                     y=str(53.3 - float(r['y']))) for r in pass_play()]
        self.assertEqual(replays.play_stats(rows), {'snaps': 1, 'topSpeed': 16.4, 'airYards': 14})

    def test_a_file_that_repeats_the_play_gets_no_numbers(self):
        rows = pass_play()
        repeat = [dict(r, frame=str(int(r['frame']) + 20)) for r in rows]
        self.assertEqual(replays.play_stats(rows + repeat), {'snaps': 2, 'topSpeed': None, 'airYards': None})

    def test_a_run_has_no_air_yards(self):
        rows = [r for r in pass_play() if r['event'] != 'pass_forward']
        self.assertIsNone(replays.play_stats(rows)['airYards'])


class IndexTests(unittest.TestCase):
    def row(self, team='SF', game='2020020200', play='3406', play_type='pass', desc='P.Mahomes pass deep right'):
        return {'season': '2019', 'seasonType': 'POST', 'week': '21', 'teamAbbr': team, 'gameId': game, 'playId': play,
                'play.playType': f'play_type_{play_type}', 'play.quarter': '4', 'play.gameClock': '03:44',
                'play.down': '2', 'play.yardsToGo': '7', 'play.playDescription': desc}

    def pbp(self, posteam='KC', defteam='SF', home_wp=0.4548, home_wp_post=0.6594, touchdown=0.0):
        return {'game_date': '2020-02-02', 'home_team': 'KC', 'away_team': 'SF', 'posteam': posteam,
                'defteam': defteam, 'desc': '(3:44) 15-P.Mahomes pass deep right to 14-S.Watkins', 'touchdown': touchdown,
                'home_wp': home_wp, 'home_wp_post': home_wp_post}

    def test_an_entry_takes_its_facts_from_play_by_play(self):
        entry = replays.index_entry(self.row(), self.pbp())
        self.assertEqual(entry['key'], '2019_SF_2020020200_3406')
        self.assertEqual((entry['away'], entry['home'], entry['featured'], entry['opponent']), ('SF', 'KC', 'KC', 'SF'))
        self.assertEqual((entry['wpBefore'], entry['wpAfter']), (0.455, 0.659))
        self.assertEqual((entry['down'], entry['yardsToGo'], entry['quarter'], entry['clock']), (2, 7, 4, '03:44'))
        self.assertFalse(entry['touchdown'])
        self.assertEqual((entry['topSpeed'], entry['airYards']), (None, None))  # no tracking file cached
        stats = {'topSpeed': 19.9, 'airYards': 38}
        self.assertEqual(replays.index_entry(self.row(), self.pbp(), stats)['airYards'], 38)

    def test_an_interception_is_seen_from_the_defense(self):
        # KC passes at home and its win probability falls: SF is featured, its swing a gain.
        entry = replays.index_entry(self.row(), self.pbp(home_wp=0.6, home_wp_post=0.4))
        self.assertEqual((entry['featured'], entry['opponent'], entry['wpBefore'], entry['wpAfter']), ('SF', 'KC', 0.4, 0.6))

    def test_a_punt_with_no_change_takes_the_receiving_teams_side(self):
        row = self.row(team='HOU', game='2020011200', play='346', play_type='punt')
        entry = replays.index_entry(row, self.pbp(posteam='KC', defteam='HOU', home_wp=0.8, home_wp_post=0.8))
        self.assertEqual(entry['featured'], 'HOU')

    def test_a_punt_takes_the_receiving_teams_side(self):
        # KC punts at home and its win probability falls: HOU, the receiving team, is featured.
        row = self.row(team='HOU', game='2020011200', play='346', play_type='punt')
        entry = replays.index_entry(row, {**self.pbp(posteam='KC', defteam='HOU', home_wp=0.8, home_wp_post=0.7),
                                          'away_team': 'HOU'})
        self.assertEqual((entry['featured'], entry['opponent']), ('HOU', 'KC'))
        self.assertEqual((entry['wpBefore'], entry['wpAfter']), (0.2, 0.3))

    def test_a_kickoff_keeps_nflverses_posteam_the_receiving_team(self):
        row = self.row(team='KC', game='2020011200', play='1287', play_type='kickoff')
        entry = replays.index_entry(row, self.pbp(posteam='KC', defteam='HOU', home_wp=0.045, home_wp_post=0.053))
        self.assertEqual((entry['featured'], entry['wpBefore']), ('KC', 0.045))
        self.assertEqual((entry['down'], entry['yardsToGo']), (2, 7))

    def test_without_play_by_play_it_keeps_the_index_facts(self):
        entry = replays.index_entry(self.row(desc='Mahomes 1 yard run, TOUCHDOWN.'), None)
        self.assertEqual((entry['date'], entry['featured'], entry['wpBefore']), (None, None, None))
        self.assertTrue(entry['touchdown'])
        self.assertEqual(entry['description'], 'Mahomes 1 yard run, TOUCHDOWN.')

    def test_a_play_listed_twice_is_kept_once(self):
        rows = [self.row(team='SF'), self.row(team='KC'), self.row(team='SF'), self.row(play='784')]
        entries = replays.index_entries(rows, lambda season, game, play: None)
        # One line per play, in game order (play 784 before 3406).
        self.assertEqual([e['key'] for e in entries], ['2019_SF_2020020200_784', '2019_KC_2020020200_3406'])


if __name__ == '__main__':
    unittest.main()
