import assert from 'node:assert/strict';
import { test } from 'node:test';

import { topOf } from '../src/lib/stats/top.ts';

const players = (pairs: [string, number | null][]) => pairs.map(([name, value]) => ({ name, value }));
const opts = { value: (p: { value: number | null }) => p.value, name: (p: { name: string }) => p.name };

test('best first, equal values share a rank, names settle the order', () => {
  const top = topOf(players([['Cook', 135], ['Henry', 144], ['Walker', 173], ['Achane', 135], ['Gibbs', 156], ['Hall', 99]]), opts);
  assert.deepEqual(top.rows.map((r) => [r.rank, r.item.name]), [
    [1, 'Walker'], [2, 'Gibbs'], [3, 'Henry'], [4, 'Achane'], [4, 'Cook'],
  ]);
  assert.equal(top.moreTied, 0);
});

test('a shared last place that does not fit is counted, not listed', () => {
  const top = topOf(players([['A', 3], ['B', 2], ['C', 1], ['D', 1], ['E', 1], ['F', 1], ['G', 1], ['H', 0]]), opts);
  assert.equal(top.rows.length, 5);
  assert.deepEqual(top.rows.map((r) => r.rank), [1, 2, 3, 3, 3]);
  assert.equal(top.moreTied, 2);
  assert.equal(top.tiedValue, 1);
});

test('counting stats leave out zeros; rates can be negative', () => {
  const list = players([['A', 0], ['B', -0.2], ['C', null], ['D', 0.1]]);
  assert.deepEqual(topOf(list, { ...opts, positiveOnly: true }).rows.map((r) => r.item.name), ['D']);
  assert.deepEqual(topOf(list, opts).rows.map((r) => r.item.name), ['D', 'A', 'B']);
});

test('nobody yet is an empty list', () => {
  assert.deepEqual(topOf([], opts), { rows: [], moreTied: 0, tiedValue: null });
});
