import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ReplayScene } from '../src/data/types.ts';
import {
  arcHeight,
  ballHeight,
  captionEventAt,
  clockAt,
  clockAtFrame,
  flightHeight,
  CARRY_HEIGHT,
  distances,
  facing,
  FLIGHT_END_HEIGHT,
  GRAVITY,
  lerpAngle,
  octant,
  prepare,
  sample,
  sampleAngle,
  mph,
  scoreAt,
  separationAt,
  smooth,
  speedTagPlayer,
  speeds,
  stride,
  THROW_FADE,
  THROW_HOLD,
  throwMarkOpacity,
  throwOf,
} from '../src/lib/replays/timeline.ts';
import { baseFor, BASES, RUN_FRAMES, spriteRows, SPRITE_H, SPRITE_W } from '../src/lib/replays/sprites.ts';
import { GLYPH_H, GLYPH_W, GLYPHS, textWidth } from '../src/lib/replays/font.ts';
import { gameWords, goalToGo, penaltyText, scorebugSituation, situationText, wpNumbers, wpSwingReadout, wpSwingText } from '../src/lib/replays/words.ts';
import { mixHex } from '../src/lib/replays/field.ts';
import { matches, sortRows, swingOf, type CatalogRow } from '../src/lib/replays/catalog.ts';

/** A ten frame pass: snap at 1, thrown at 3, caught at 7 by the receiver (player 1), a touchdown at 9. */
function scene(overrides: Partial<ReplayScene> = {}): ReplayScene {
  const frames = 10;
  return {
    version: 1,
    key: 'test',
    source: 'test',
    hz: 10,
    scale: 10,
    frameCount: frames,
    play: {
      season: 2018, seasonType: 'REG', week: 3, gameId: '2018092311', playId: 141, quarter: 1, clock: '12:20',
      down: 2, yardsToGo: 6, yardline: 'CHI 35', scoreBefore: { home: 0, away: 0 }, scoreAfter: { home: 6, away: 0 },
      description: 'A pass.', date: '2018-09-23', nflverseGameId: '2018_03_CHI_ARI', wpBefore: 0.621, wpAfter: 0.697,
      type: 'pass', featured: 'ARI', opponent: 'CHI', possession: 'ARI', home: 'ARI', away: 'CHI', kicking: null, penalty: null,
    },
    field: { lineOfScrimmage: 75, firstDown: 81, attack: 1 },
    teams: { featured: { abbr: 'ARI', primary: '#97233f', secondary: '#000000' }, opponent: { abbr: 'CHI', primary: '#0b162a', secondary: '#e64100' } },
    events: [
      { frame: 1, name: 'ball_snap' }, { frame: 3, name: 'pass_forward' }, { frame: 7, name: 'pass_outcome_caught' },
      { frame: 9, name: 'touchdown' },
    ],
    flights: [{ kind: 'pass', from: 3, to: 7 }],
    ball: { x: Array.from({ length: frames }, (_, f) => 750 + f * 30), y: new Array(frames).fill(250) },
    carrier: [null, 0, 0, null, null, null, null, 1, 1, 1],
    players: [
      { id: 'qb', side: 'featured', jersey: 9, position: 'QB', name: 'QB', x: new Array(frames).fill(740), y: new Array(frames).fill(250), dir: new Array(frames).fill(270), o: new Array(frames).fill(90) },
      { id: 'wr', side: 'featured', jersey: 86, position: 'TE', name: 'WR', x: Array.from({ length: frames }, (_, f) => 750 + f * 8), y: new Array(frames).fill(200), dir: new Array(frames).fill(90), o: new Array(frames).fill(0) },
    ],
    ...overrides,
  };
}

test('series sample linearly between frames and hold across gaps', () => {
  assert.equal(sample([0, 10, 20], 1.5), 15);
  assert.equal(sample([0, 10, 20], 7), 20);
  assert.equal(sample([0, null, 20], 0.5), 0);
  assert.equal(sample([null, null], 0.5), null);
});

test('angles blend the short way round', () => {
  assert.equal(lerpAngle(350, 10, 0.5), 0);
  assert.equal(lerpAngle(10, 350, 0.25), 5);
  assert.equal(sampleAngle([350, 10], 0.5), 0);
  assert.equal(sampleAngle([null, 10], 0.5), 10);
});

test('eight facings: up the screen is away from the camera, clockwise', () => {
  assert.deepEqual([0, 44, 90, 135, 180, 225, 270, 315, 359].map(octant), [0, 1, 2, 3, 4, 5, 6, 7, 0]);
  assert.deepEqual(baseFor(6), { base: 'R', mirror: true });
  assert.deepEqual(baseFor(4), { base: 'D', mirror: false });
});

test('speed and distance come from positions', () => {
  const x = [0, 1, 2, null, 4];
  const y = [0, 0, 0, null, 0];
  assert.deepEqual(speeds(x, y, 10).slice(0, 2), [10, 10]);
  assert.equal(speeds(x, y, 10)[2], null);
  assert.deepEqual(distances(x, y), [0, 1, 2, null, 2]);
});

test('a moving player faces his travel, a standing one his body', () => {
  const prep = prepare(scene());
  assert.equal(facing(prep.players[1]!, 5), 2); // the receiver runs right at 8 yards a second
  assert.equal(facing(prep.players[0]!, 5), 2); // the passer stands, body toward the defense
  assert.equal(stride(prep.players[0]!, 5), 0);
  assert.ok(stride(prep.players[1]!, 5) >= 1);
});

test('the ball rises on a parabola under gravity from 2 yards back to 2', () => {
  assert.equal(arcHeight(0, 1.5), FLIGHT_END_HEIGHT);
  assert.equal(arcHeight(1.5, 1.5), FLIGHT_END_HEIGHT);
  assert.ok(Math.abs(arcHeight(0.75, 1.5) - (FLIGHT_END_HEIGHT + (GRAVITY * 1.5 ** 2) / 8)) < 1e-9);
  const prep = prepare(scene());
  assert.equal(ballHeight(prep, 0), 0); // on the ground before the snap
  assert.equal(ballHeight(prep, 2), CARRY_HEIGHT);
  assert.ok(ballHeight(prep, 5) > 2);
  assert.equal(ballHeight(prep, 8), CARRY_HEIGHT);
});

test("a scene's own ball height wins over the arc", () => {
  const prep = prepare(scene({ ball: { ...scene().ball, z: new Array(10).fill(55) } }));
  assert.equal(ballHeight(prep, 5), 5.5);
});

test('a scene with only a ball path still prepares, the camera on the ball', () => {
  const s = scene();
  delete s.players;
  delete s.carrier;
  const prep = prepare(s);
  assert.equal(prep.players.length, 0);
  assert.equal(Math.round(prep.camera.x[0]!), Math.round(smooth(s.ball.x.map((v) => v / 10))[0]!));
});

test('camera smoothing keeps a still target still and stays inside a moving one', () => {
  assert.deepEqual(smooth([5, 5, 5]), [5, 5, 5]);
  const moved = smooth([0, 0, 10, 10]);
  assert.ok(moved.every((v) => v >= 0 && v <= 10));
  assert.ok(moved[1]! > 0 && moved[2]! < 10);
});

test('the scorebug: running clock, situation, score after the touchdown, the swing at the end', () => {
  assert.equal(clockAt('12:20', 0), '12:20');
  assert.equal(clockAt('12:20', 6.4), '12:14');
  assert.equal(clockAt('00:03', 9), '0:00');
  const s = scene();
  assert.equal(scorebugSituation(s.play, false), '2nd and 6 at CHI 35');
  assert.equal(scorebugSituation(s.play, true), '2nd and goal at CHI 35');
  assert.equal(scorebugSituation({ ...s.play, type: 'kickoff', down: null }, false), 'Kickoff');
  assert.deepEqual(scoreAt(s, 8), { home: 0, away: 0 });
  assert.deepEqual(scoreAt(s, 9), { home: 6, away: 0 });
  assert.equal(wpSwingReadout(s.play), '→ 70% (+8)');
  assert.equal(wpSwingReadout({ ...s.play, wpAfter: 0.55 }), '→ 55% (-7)');
  assert.equal(wpSwingReadout({ ...s.play, wpAfter: null }), null);
});

test('captions come and go; a touchdown stays', () => {
  const s = scene();
  assert.equal(captionEventAt(s, 0), null);
  assert.equal(captionEventAt(s, 3.5), 'pass_forward');
  assert.equal(captionEventAt(s, 7), 'pass_outcome_caught');
  assert.equal(captionEventAt(s, 9.9), 'touchdown');
});

test('the throw: air yards past the line, the receiver, separation when the ball arrives', () => {
  const base = scene();
  // A defender trailing the receiver by 3 yards across and 4 along at every frame.
  const wr = base.players![1]!;
  const cb = { ...wr, id: 'cb', side: 'opponent' as const, jersey: 24, x: wr.x.map((v) => v! - 40), y: wr.y.map((v) => v! + 30) };
  const prep = prepare(scene({ players: [...base.players!, cb] }));
  const thrown = throwOf(prep)!;
  assert.equal(thrown.airYards, Math.round(prep.ball.x[7]! - 75));
  assert.equal(thrown.receiver, 1);
  assert.equal(thrown.catchFrame, 7);
  assert.deepEqual(separationAt(prep, thrown.to, 1), { defender: 2, yards: 5 });
  assert.equal(speedTagPlayer(prep, 5, thrown), 1); // in the air: the receiver
  assert.equal(speedTagPlayer(prep, 8, thrown), 1); // after: the carrier
  assert.equal(speedTagPlayer(prep, 0, thrown), null);
  assert.ok(Math.abs(mph(10) - 20.45) < 0.01);
});

test('the throw marks hold a second after the catch, then fade', () => {
  const thrown = throwOf(prepare(scene()))!;
  const hz = 10;
  assert.equal(throwMarkOpacity(thrown, 2, hz), 0);
  assert.equal(throwMarkOpacity(thrown, 3, hz), 1);
  assert.equal(throwMarkOpacity(thrown, 7 + THROW_HOLD * hz, hz), 1);
  assert.ok(Math.abs(throwMarkOpacity(thrown, 7 + THROW_HOLD * hz + (THROW_FADE * hz) / 2, hz) - 0.5) < 1e-9);
  assert.equal(throwMarkOpacity(thrown, 7 + (THROW_HOLD + THROW_FADE) * hz + 1, hz), 0);
});

test('end zones are a tint of the team color', () => {
  assert.equal(mixHex('#000000', '#ffffff', 0.5), '#808080');
  assert.equal(mixHex('#7f9577', '#97233f', 0), '#7f9577');
});

test('sprites: every drawing and run frame is 13 by 21 in palette letters', () => {
  for (const base of BASES) {
    for (let f = 0; f < RUN_FRAMES; f++) {
      const rows = spriteRows(base, f);
      assert.equal(rows.length, SPRITE_H, `${base} ${f}`);
      for (const row of rows) {
        assert.equal(row.length, SPRITE_W, `${base} ${f}: ${row}`);
        assert.match(row, /^[.ohsvmjtngpkb]+$/);
      }
      // Anchored at the feet: the bottom row is drawn.
      assert.notEqual(rows[SPRITE_H - 1]!.replace(/\./g, ''), '');
    }
  }
});

test('font: every glyph is 5 by 7, and widths add up', () => {
  for (const [ch, rows] of Object.entries(GLYPHS)) {
    assert.equal(rows.length, GLYPH_H, ch);
    for (const row of rows) assert.match(row, new RegExp(`^[.#]{${GLYPH_W}}$`), ch);
  }
  assert.equal(textWidth('AB'), 13);
  assert.equal(textWidth('AB', { bold: false, scale: 2 }), 22);
});

test('page words', () => {
  const play = scene().play;
  assert.equal(gameWords(play), 'CHI at ARI, 2018 week 3');
  assert.equal(gameWords({ ...play, season: 2019, seasonType: 'POST', week: 19, away: 'SEA', home: 'GB' }), 'SEA at GB, 2019 divisional round');
  assert.equal(situationText(play, false), '2nd and 6 at CHI 35, 1st quarter, 12:20');
  assert.equal(situationText({ ...play, clock: '06:27' }, true), '2nd and goal at CHI 35, 1st quarter, 6:27');
  assert.equal(wpSwingText(play), '62% to 70% (+8 points)');
  assert.equal(wpSwingText({ ...play, wpAfter: null }), null);
});

/** A kickoff: kicked off the tee at frame 2, received at 8 by player 0 (the returner), out of bounds at 12. */
function kickoff(): ReplayScene {
  const base = scene();
  const frames = 16;
  return {
    ...base,
    frameCount: frames,
    play: { ...base.play, type: 'kickoff', down: null, yardsToGo: null, clock: '10:54', featured: 'KC', opponent: 'HOU', possession: 'HOU', home: 'KC', away: 'HOU', kicking: 'HOU' },
    field: { lineOfScrimmage: 75, firstDown: null, attack: -1 },
    events: [{ frame: 2, name: 'kickoff' }, { frame: 8, name: 'kick_received' }, { frame: 12, name: 'out_of_bounds' }],
    flights: [{ kind: 'kick', from: 2, to: 8 }],
    ball: { x: Array.from({ length: frames }, (_, f) => 750 - Math.min(f, 8) * 80), y: new Array(frames).fill(266) },
    carrier: Array.from({ length: frames }, (_, f) => (f >= 8 ? 0 : null)),
    players: [{ id: 'kr', side: 'featured', jersey: 17, position: 'WR', name: 'KR', x: new Array(frames).fill(110), y: new Array(frames).fill(266) }],
  };
}

test('a kickoff starts off the tee and the clock waits for the return man', () => {
  const prep = prepare(kickoff());
  assert.equal(ballHeight(prep, 2), 0); // on the tee
  assert.equal(ballHeight(prep, 8), FLIGHT_END_HEIGHT); // caught at hand height
  // Halfway through a 0.6 s flight: halfway from 0 to 2, plus gravity's bulge.
  assert.ok(Math.abs(ballHeight(prep, 5) - (1 + 0.5 * GRAVITY * 0.3 * 0.3)) < 1e-9);
  assert.equal(prep.clockFrame, 8); // the return man's touch, not the kick at 2
  assert.equal(clockAtFrame(prep, 7.9), '10:54'); // 0.59 s in the air: no time off
  // A touchback never starts it; a scrimmage play starts at the snap.
  const touchback = prepare({ ...kickoff(), events: [{ frame: 2, name: 'kickoff' }, { frame: 8, name: 'touchback' }] });
  assert.equal(touchback.clockFrame, 15);
  assert.equal(prepare(scene()).clockFrame, 1);
});

test('a punt leaves the foot a yard up; a pass the hand at two', () => {
  const punt = { ...kickoff(), flights: [{ kind: 'punt', from: 2, to: 8 }] };
  assert.equal(flightHeight(punt, 2), 1);
  assert.equal(flightHeight(scene(), 3), FLIGHT_END_HEIGHT);
  assert.equal(flightHeight(scene(), 0), 0);
  assert.equal(arcHeight(0, 2, 0, 2), 0);
  assert.equal(arcHeight(1, 2, 0, 2), 1 + 0.5 * GRAVITY);
});

test('the camera rises with a ball in the air, so a high kick stays in view', () => {
  const s = kickoff();
  const grounded = prepare({ ...s, flights: [] });
  const flying = prepare(s);
  assert.ok(flying.camera.y[5]! > grounded.camera.y[5]!);
  assert.equal(flying.camera.y[0]! >= grounded.camera.y[0]!, true);
});

test('a player who enters or leaves mid scene is drawn only while tracked', () => {
  const entering = [null, null, 5, 6];
  assert.equal(sample(entering, 0.5), null);
  assert.equal(sample(entering, 2.5), 5.5);
  const leaving = [1, 2, null, null];
  assert.equal(sample(leaving, 1.5), 2); // holds his last spot for the half frame
  assert.equal(sample(leaving, 2.5), null);
});

test('win probability shows a decimal when whole numbers would hide the swing', () => {
  assert.deepEqual(wpNumbers(0.621, 0.697), { before: '62%', after: '70%', swing: '+8' });
  assert.deepEqual(wpNumbers(0.045, 0.053), { before: '4.5%', after: '5.3%', swing: '+0.8' });
  assert.deepEqual(wpNumbers(0.5, 0.5), { before: '50%', after: '50%', swing: '+0' });
  assert.equal(wpSwingText({ ...scene().play, wpBefore: 0.045, wpAfter: 0.053 }), '4.5% to 5.3% (+0.8 points)');
  assert.equal(wpSwingReadout({ ...scene().play, wpBefore: 0.045, wpAfter: 0.053 }), '→ 5.3% (+0.8)');
});

test('the highlights list filters by team and type and sorts by swing, date or type', () => {
  const row = (key: string, date: string, teams: string[], type: string, swing: number | null, order: number): CatalogRow => ({ key, date, teams, type, swing, order });
  const rows = [
    row('a', '2019-01-06', ['PHI', 'CHI'], 'pass', 12.5, 0),
    row('b', '2018-12-09', ['NE', 'MIA'], 'pass', 91.1, 1),
    row('c', '', [], 'rush', null, 2),
    row('d', '2019-09-15', ['ATL', 'PHI'], 'kickoff', -45, 3),
    row('e', '2018-01-14', ['NO', 'MIN'], 'pass', 12.5, 4),
  ];
  assert.deepEqual(sortRows(rows, 'swing', 'desc').map((r) => r.key), ['b', 'd', 'a', 'e', 'c']); // by size either way; ties keep order; none last
  assert.deepEqual(sortRows(rows, 'swing', 'asc').map((r) => r.key), ['a', 'e', 'd', 'b', 'c']);
  assert.deepEqual(sortRows(rows, 'date', 'desc').map((r) => r.key), ['d', 'a', 'b', 'e', 'c']);
  assert.deepEqual(sortRows(rows, 'type', 'asc').map((r) => r.key), ['d', 'a', 'b', 'e', 'c']); // Kickoff, Pass, Run
  assert.equal(matches(rows[0]!, 'PHI', ''), true);
  assert.equal(matches(rows[0]!, 'PHI', 'kickoff'), false);
  assert.equal(matches(rows[3]!, 'PHI', 'kickoff'), true);
  assert.equal(matches(rows[2]!, 'PHI', ''), false);
  assert.equal(swingOf(0.089, 1), 91.1);
  assert.equal(swingOf(0.89, 0.388), -50.2);
  assert.equal(swingOf(null, 0.5), null);
});

test('the dev catalog sorts by top speed and air yards, plays without them last', () => {
  const row = (key: string, speed: number | null, air: number | null, order: number): CatalogRow => ({ key, date: '', teams: [], type: 'pass', swing: null, speed, air, order });
  const rows = [row('a', 19.2, 12, 0), row('b', null, null, 1), row('c', 21.7, 45, 2), row('d', 15.0, -3, 3)];
  assert.deepEqual(sortRows(rows, 'speed', 'desc').map((r) => r.key), ['c', 'a', 'd', 'b']);
  assert.deepEqual(sortRows(rows, 'air', 'asc').map((r) => r.key), ['d', 'a', 'c', 'b']);
});

test('when the other team is featured, the team that snapped goes right to left', () => {
  // A pick-six seen from the defense: the passing team attacks toward x = 0.
  const base = scene();
  const flipped = scene({
    field: { lineOfScrimmage: 45, firstDown: 39, attack: -1 },
    ball: { x: base.ball.x.map((v) => 1200 - v), y: base.ball.y },
    players: base.players!.map((p) => ({ ...p, side: 'opponent' as const, x: p.x.map((v) => (v === null ? null : 1200 - v)) })),
  });
  const thrown = throwOf(prepare(flipped))!;
  assert.equal(thrown.airYards, throwOf(prepare(base))!.airYards); // the same throw, measured its own way
  assert.equal(goalToGo({ lineOfScrimmage: 15, firstDown: 10, attack: -1 }), true);
  assert.equal(goalToGo({ lineOfScrimmage: 45, firstDown: 39, attack: -1 }), false);
  assert.equal(goalToGo({ lineOfScrimmage: 105, firstDown: 110, attack: 1 }), true);
});

test('a penalty reads in plain words', () => {
  assert.equal(penaltyText({ team: 'NO', player: 'M.Williams', type: 'Face Mask', yards: 14 }), 'Face mask on NO (M.Williams), 14 yards');
  assert.equal(penaltyText({ team: 'NO', player: null, type: 'Offside', yards: 1 }), 'Offside on NO, 1 yard');
  assert.equal(penaltyText(null), null);
});

test('a touchdown pass scores and keeps its caption', () => {
  const s = scene({ events: [{ frame: 1, name: 'ball_snap' }, { frame: 3, name: 'pass_forward' }, { frame: 7, name: 'pass_outcome_touchdown' }] });
  assert.deepEqual(scoreAt(s, 6), { home: 0, away: 0 });
  assert.deepEqual(scoreAt(s, 7), { home: 6, away: 0 });
  assert.equal(captionEventAt(s, 9.9), 'pass_outcome_touchdown');
});
