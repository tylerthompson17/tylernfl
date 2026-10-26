import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ReplayScene } from '../src/data/types.ts';
import {
  arcHeight,
  ballHeight,
  captionEventAt,
  clockAt,
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
import { gameWords, scorebugSituation, situationText, wpSwingReadout, wpSwingText } from '../src/lib/replays/words.ts';
import { mixHex } from '../src/lib/replays/field.ts';

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
      type: 'pass', offense: 'ARI', defense: 'CHI', home: 'ARI', away: 'CHI', kicking: null,
    },
    field: { lineOfScrimmage: 75, firstDown: 81 },
    teams: { offense: { abbr: 'ARI', primary: '#97233f', secondary: '#000000' }, defense: { abbr: 'CHI', primary: '#0b162a', secondary: '#e64100' } },
    events: [
      { frame: 1, name: 'ball_snap' }, { frame: 3, name: 'pass_forward' }, { frame: 7, name: 'pass_outcome_caught' },
      { frame: 9, name: 'touchdown' },
    ],
    flights: [{ kind: 'pass', from: 3, to: 7 }],
    ball: { x: Array.from({ length: frames }, (_, f) => 750 + f * 30), y: new Array(frames).fill(250) },
    carrier: [null, 0, 0, null, null, null, null, 1, 1, 1],
    players: [
      { id: 'qb', side: 'offense', jersey: 9, position: 'QB', name: 'QB', x: new Array(frames).fill(740), y: new Array(frames).fill(250), dir: new Array(frames).fill(270), o: new Array(frames).fill(90) },
      { id: 'wr', side: 'offense', jersey: 86, position: 'TE', name: 'WR', x: Array.from({ length: frames }, (_, f) => 750 + f * 8), y: new Array(frames).fill(200), dir: new Array(frames).fill(90), o: new Array(frames).fill(0) },
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
  const cb = { ...wr, id: 'cb', side: 'defense' as const, jersey: 24, x: wr.x.map((v) => v! - 40), y: wr.y.map((v) => v! + 30) };
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
