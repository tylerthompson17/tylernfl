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

    def test_win_probability_is_the_offenses(self):
        # DAL's two point try at NYJ, 2019 week 6: home_wp 0.802, DAL's wp 0.198.
        self.assertEqual(replays.offense_wp(0.8023656890392303, 'DAL', 'NYJ'), 0.198)
        self.assertEqual(replays.offense_wp(0.6205621957778931, 'ARI', 'ARI'), 0.621)
        self.assertIsNone(replays.offense_wp(None, 'ARI', 'ARI'))
        self.assertIsNone(replays.offense_wp(float('nan'), 'ARI', 'CHI'))

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

    def test_a_new_carrier_needs_three_frames_in_a_row(self):
        frames = {}
        for f in range(12):
            if f < 4:
                ball = (74.0, 25.0, 0)  # on the QB
            elif f in (4, 5):
                ball = (72.5, 26.5, 0)  # beside the RB for two frames only
            elif f < 7:
                ball = (74.0, 25.0, 0)
            else:
                ball = (72.0, 27.0, 0)  # on the RB from 7
            frames[f] = {'ball': ball, 'qb': (74.0, 25.0, 0), 'rb': (72.0, 27.0, 0)}
        carriers = self.carriers(play(frames, {1: 'ball_snap', 3: 'handoff'}), 'rush')
        self.assertEqual(carriers[2], 'qb')  # pinned before the handoff
        self.assertEqual([carriers[f] for f in (3, 4, 5, 6)], ['qb'] * 4)  # RB nearest for 2 frames: no switch
        self.assertEqual([carriers[f] for f in (7, 8, 9)], ['qb', 'qb', 'rb'])

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
        self.assertEqual(scene['field'], {'lineOfScrimmage': 75.0, 'firstDown': 81.0})
        self.assertEqual(scene['ball']['x'][0], 750)
        self.assertEqual(scene['ball']['y'][0], 250)
        self.assertEqual(scene['players'][0]['dir'][0], 270)

    def test_scene_layout(self):
        scene = replays.build_scene('2018_ARI_2018092311_141', pass_play(), self.PBP, self.COLORS)
        self.assertEqual(scene['frameCount'], 13)  # snap at 2, under LEAD_FRAMES from frame 0
        self.assertEqual([p['side'] for p in scene['players']], ['offense'] * 3 + ['defense'])
        self.assertEqual(scene['teams']['offense'], {'abbr': 'ARI', 'primary': '#97233f', 'secondary': '#000000'})
        self.assertEqual(scene['flights'], [{'kind': 'pass', 'from': 4, 'to': 7}])
        slots = {p['id']: i for i, p in enumerate(scene['players'])}
        self.assertEqual(scene['carrier'][2], slots['qb'])
        self.assertEqual(scene['carrier'][7], slots['wr'])
        self.assertIsNone(scene['carrier'][5])
        play = scene['play']
        self.assertEqual((play['wpBefore'], play['wpAfter']), (0.62, 0.697))
        self.assertEqual(play['scoreAfter'], {'home': 6, 'away': 0})
        self.assertEqual((play['offense'], play['home'], play['away']), ('ARI', 'ARI', 'CHI'))
        self.assertEqual(replays.summary(scene)['seconds'], 1.3)

    def kickoff(self, direction):
        """ARI (home, flagged in possession) kicks at frame 2; CHI's returner
        catches it at 6 and runs it back."""
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
        return replays.build_scene('2019_CHI_2019100600_1', rows, self.PBP, self.COLORS)

    def test_kicks_take_the_receiving_teams_side(self):
        for direction in ('left', 'right'):
            scene = self.kickoff(direction)
            play = scene['play']
            self.assertEqual((play['offense'], play['defense'], play['kicking']), ('CHI', 'ARI', 'ARI'))
            self.assertEqual(scene['field'], {'lineOfScrimmage': 65.0, 'firstDown': None})
            # The return runs left to right whichever way the kicking team went.
            returner = scene['players'][0]
            self.assertEqual(returner['id'], 'cb')
            self.assertLess(returner['x'][6], returner['x'][11])
            self.assertEqual(scene['flights'], [{'kind': 'kick', 'from': 2, 'to': 6}])
            self.assertEqual(scene['carrier'][7], 0)
            # ARI is home: CHI's win probability is the other side of home_wp.
            self.assertEqual((play['wpBefore'], play['wpAfter']), (0.38, 0.303))

    def test_scenes_store_no_speed(self):
        scene = replays.build_scene('2018_ARI_2018092311_141', pass_play(), self.PBP, self.COLORS)
        self.assertEqual(set(scene['players'][0]), {'id', 'side', 'jersey', 'position', 'name', 'x', 'y', 'dir', 'o'})
        self.assertIsNone(scene['play']['kicking'])

    def test_retired_abbreviations_keep_their_name_and_take_todays_colors(self):
        colors = {'LV': {'primary': '#000000', 'secondary': '#a5acaf'}}
        self.assertEqual(replays.team_entry('OAK', colors), {'abbr': 'OAK', 'primary': '#000000', 'secondary': '#a5acaf'})
        self.assertEqual(replays.team_entry('LA', {'LAR': colors['LV']})['abbr'], 'LAR')


if __name__ == '__main__':
    unittest.main()
