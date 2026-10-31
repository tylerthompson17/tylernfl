import assert from 'node:assert/strict';
import { test } from 'node:test';

import { tickerSpread } from '../src/lib/odds/spread.ts';

test('the spread sits beside the favored team, written as a sportsbook does', () => {
  // nflverse's spreadLine is points the home team is favored by.
  assert.deepEqual(tickerSpread(3), { side: 'home', text: '-3', words: 'favored by 3' });
  assert.deepEqual(tickerSpread(-6.5), { side: 'away', text: '-6.5', words: 'favored by 6.5' });
  assert.deepEqual(tickerSpread(10.0), { side: 'home', text: '-10', words: 'favored by 10' });
});

test("a pick'em says PK beside the home team", () => {
  assert.deepEqual(tickerSpread(0), { side: 'home', text: 'PK', words: "pick'em" });
  assert.deepEqual(tickerSpread(-0), { side: 'home', text: 'PK', words: "pick'em" });
});

test('no line yet shows nothing', () => {
  assert.equal(tickerSpread(null), null);
  assert.equal(tickerSpread(undefined), null);
  assert.equal(tickerSpread(Number.NaN), null);
});
