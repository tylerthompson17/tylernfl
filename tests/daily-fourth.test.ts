import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DailyFourthPlay } from '../src/data/types.ts';
import {
  downWords,
  emptyStore,
  fieldWords,
  nfl4thLine,
  optionsOf,
  parseStore,
  pickLine,
  picksFor,
  scoreLine,
  scoreOf,
  scoreWords,
  shareText,
  streaks,
  withPick,
  wpLost,
  type ScoredGame,
} from '../src/lib/daily-fourth/game.ts';

const play = (over: Partial<DailyFourthPlay> = {}): DailyFourthPlay => ({
  key: '2026_02_IND_KC:3975', gameId: '2026_02_IND_KC', week: 2, away: 'IND', home: 'KC', offense: 'IND',
  defense: 'KC', coach: 'Shane Steichen', quarter: 4, clock: 34, distance: 4, yardline100: 51, scoreDiff: 0,
  timeoutsOffense: 1, timeoutsDefense: 3, wp: { go: 0.43649, punt: 0.35233, 'field goal': 0.22108 }, call: 'go',
  margin: 0.08416, close: false, teamCall: 'punt', coachWpLost: 0.08416, result: 'Punted 41 yards',
  description: '(0:34) punts 41 yards', ...over,
});

const game = (n = 1, plays = [play(), play({ wp: { go: 0.6, punt: 0.5, 'field goal': null }, call: 'go', teamCall: 'go', coachWpLost: 0 })]): ScoredGame => ({
  date: '2026-10-25', number: n, plays,
});

test('situation words from either side', () => {
  assert.equal(downWords(play()), '4th and 4');
  assert.equal(downWords(play({ yardline100: 3, distance: 3 })), '4th and goal');
  assert.equal(fieldWords(play(), false), 'Own 49');
  assert.equal(fieldWords(play(), true), 'IND 49');
  assert.equal(fieldWords(play({ yardline100: 23 }), false), "Opponent's 23");
  assert.equal(fieldWords(play({ yardline100: 23 }), true), 'KC 23');
  assert.equal(fieldWords(play({ yardline100: 50 }), true), 'Midfield');
  assert.equal(scoreWords(play({ scoreDiff: -7 }), false), 'Down 7');
  assert.equal(scoreWords(play({ scoreDiff: 3 }), true), 'IND up 3');
  assert.equal(scoreWords(play(), true), 'Tied');
});

test('only the options the model allows', () => {
  assert.deepEqual(optionsOf(play({ wp: { go: 0.5, punt: 0.4, 'field goal': null } })), ['go', 'punt']);
});

test('estimates, never right or wrong', () => {
  assert.equal(nfl4thLine(play()), 'nfl4th says Go for it, by 8.4 points.');
  assert.equal(nfl4thLine(play({ close: true, margin: 0.004, call: 'punt' })), 'A close call: nfl4th leaned Punt, by 0.4 points.');
  assert.equal(nfl4thLine(play({ close: true, margin: 0.00005, call: 'punt' })), 'A close call: nfl4th leaned Punt, by less than 0.1 points.');
  assert.equal(pickLine(play(), 'go'), 'You picked Go for it, the same as nfl4th.');
  assert.equal(pickLine(play(), 'punt'), "You picked Punt: 8.4 points of win probability below nfl4th's estimate for Go for it.");
  for (const line of [nfl4thLine(play()), pickLine(play(), 'punt')]) assert.doesNotMatch(line, /correct|wrong/i);
});

test('score against nfl4th and the coaches', () => {
  assert.equal(wpLost(play(), 'field goal'), 0.21541);
  const s = scoreOf(game().plays, ['go', 'punt']);
  assert.equal(s.same, 1);
  assert.ok(Math.abs(s.you - 0.1) < 1e-9);
  assert.equal(
    scoreLine(s, 2),
    "You gave up 10.0 points of win probability against nfl4th's estimates, 1.6 points more than the coaches (8.4 points). You matched nfl4th on 1 of 2.",
  );
});

test('share text has no plays in it', () => {
  const text = shareText(game(), ['go', 'punt'], 'https://example.test/daily/');
  assert.equal(text, [
    '4th down daily #1, October 25, 2026',
    '1. Same as nfl4th',
    '2. -10.0',
    'WP given up: 10.0 points (the coaches: 8.4)',
    'https://example.test/daily/',
  ].join('\n'));
  assert.doesNotMatch(text, /IND|KC|Steichen/);
  const close = game(1, [play({ wp: { go: 0.40224, punt: 0.4023, 'field goal': null }, call: 'punt' })]);
  assert.match(shareText(close, ['go'], 'x'), /^1\. Under 0\.1 below nfl4th$/m);
});

test('picks are kept until the day is filed, once', () => {
  let store = withPick(emptyStore(), game(), 'go');
  assert.deepEqual(store.progress, { number: 1, picks: ['go'] });
  store = withPick(store, game(), 'punt');
  assert.equal(store.progress, null);
  assert.equal(store.days.length, 1);
  assert.deepEqual(picksFor(store, game()), ['go', 'punt']);
  assert.equal(withPick(store, game(), 'go'), store);
  assert.deepEqual(picksFor(store, game(2)), []);
});

test('stored values that are not ours start over', () => {
  assert.deepEqual(parseStore('not json'), emptyStore());
  assert.deepEqual(parseStore('{"v":2}'), emptyStore());
  assert.equal(parseStore(JSON.stringify({ ...emptyStore(), names: true })).names, true);
});

test('streaks run back from today, or from yesterday until today is played', () => {
  const store = { ...emptyStore(), days: [1, 2, 3, 5, 6].map((number) => ({ number, date: '2026-10-25', picks: [], wpLost: 0, coachWpLost: 0 })) };
  assert.deepEqual(streaks(store, 6), { current: 2, best: 3, played: 5 });
  assert.deepEqual(streaks(store, 7), { current: 2, best: 3, played: 5 });
  assert.deepEqual(streaks(store, 8), { current: 0, best: 3, played: 5 });
});
