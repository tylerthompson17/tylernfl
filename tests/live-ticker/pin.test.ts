import assert from 'node:assert/strict';
import { test } from 'node:test';

import { carouselOffset, scoreChanged, showsStrip, stripInsertIndex } from '../../src/lib/live-ticker/pin.ts';

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

test('the strip keeps its place while a readable game still fits', () => {
  assert.equal(showsStrip(900, 12), true);
  assert.equal(showsStrip(160, 12), true);
});

test('a full slate of live games squeezes the strip out', () => {
  assert.equal(showsStrip(159, 12), false);
  assert.equal(showsStrip(0, 12), false);
  assert.equal(showsStrip(-40, 12), false);
});

test('an empty strip takes no width', () => {
  assert.equal(showsStrip(900, 0), false);
});

test('the carousel rests on slot edges, measured as the slots are now', () => {
  assert.equal(carouselOffset([122, 130, 118], 0), 0);
  assert.equal(carouselOffset([122, 130, 118], 2), 252);
  assert.equal(carouselOffset([122, 130, 118], 3), 370);
  assert.equal(carouselOffset([122, 130, 118], 9), 370);
  // A live score going to two digits widens its slot; the next rest follows.
  assert.equal(carouselOffset([122, 136, 118], 2), 258);
});
