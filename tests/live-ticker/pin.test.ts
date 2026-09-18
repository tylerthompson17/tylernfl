import assert from 'node:assert/strict';
import { test } from 'node:test';

import { scoreChanged, stripInsertIndex } from '../../src/lib/live-ticker/pin.ts';

test('a game going final rejoins the strip after the other finals', () => {
  assert.equal(stripInsertIndex(['final', 'final', 'pre', 'pre']), 2);
  assert.equal(stripInsertIndex(['pre', 'pre']), 0);
  assert.equal(stripInsertIndex(['final', 'final']), 2);
  assert.equal(stripInsertIndex([]), 0);
});

test('a real score change is marked', () => {
  assert.equal(scoreChanged('14', 21), true);
  assert.equal(scoreChanged('7', 9), true);
});

test('filling an empty score or repeating it is not a change', () => {
  assert.equal(scoreChanged('', 7), false);
  assert.equal(scoreChanged('14', 14), false);
  assert.equal(scoreChanged('14', null), false);
});
