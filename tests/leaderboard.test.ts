import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  arrange,
  capArrangement,
  cellValue,
  defaultDirection,
  formatCell,
  rowsForTopN,
  type ColumnSpec,
  type RowSpec,
} from '../src/lib/leaderboard/arrange.ts';

const yards: ColumnSpec = { key: 'yds', format: 'integer', perGame: true, rate: false, better: 'high' };
const ypc: ColumnSpec = { key: 'ypc', format: 'decimal1', perGame: false, rate: true, better: 'high' };
const fumbles: ColumnSpec = { key: 'fl', format: 'integer', perGame: true, rate: false, better: 'low' };
const pct: ColumnSpec = { key: 'pct', format: 'percent1', perGame: false, rate: true, better: 'high' };

function row(values: Record<string, number | null>, qualified = true): RowSpec {
  return { values, qualified };
}

// Barkley: 2 games, qualified. Hall: 1 game, qualified. Backup: 1 game, not.
const rows = [
  row({ games: 2, yds: 250, ypc: 5.0, fl: 1 }),
  row({ games: 1, yds: 150, ypc: 6.0, fl: 0 }),
  row({ games: 1, yds: 60, ypc: 12.0, fl: 0 }, false),
];

test('totals rank everyone by the column', () => {
  const { order, ranks, shown } = arrange(rows, yards, 'desc', 'totals');
  assert.deepEqual(order, [0, 1, 2]);
  assert.deepEqual(ranks, [1, 2, 3]);
  assert.deepEqual(shown, [true, true, true]);
});

test('rate columns rank qualified players only', () => {
  const { order, ranks, shown } = arrange(rows, ypc, 'desc', 'totals');
  assert.deepEqual(order, [1, 0, 2]);
  assert.deepEqual(ranks, [2, 1, null]);
  assert.deepEqual(shown, [true, true, false]);
});

test('per game divides counting stats and ranks qualified players only', () => {
  assert.equal(cellValue(rows[0]!, yards, 'perGame'), 125);
  assert.equal(cellValue(rows[0]!, ypc, 'perGame'), 5.0);
  const { order, ranks } = arrange(rows, yards, 'desc', 'perGame');
  assert.deepEqual(order, [1, 0, 2]);
  assert.deepEqual(ranks, [2, 1, null]);
});

test('lower is better sorts ascending first, and equal shown values share a rank', () => {
  assert.equal(defaultDirection(fumbles), 'asc');
  const { order, ranks } = arrange(rows, fumbles, 'asc', 'totals');
  assert.deepEqual(order, [1, 2, 0]);
  assert.deepEqual(ranks, [3, 1, 1]);
});

test('empty values sort last whichever way the column runs', () => {
  const withGap = [row({ games: 1, pct: null }), row({ games: 1, pct: 0.5 }), row({ games: 1, pct: 0.7 })];
  assert.deepEqual(arrange(withGap, pct, 'desc', 'totals').order, [2, 1, 0]);
  assert.deepEqual(arrange(withGap, pct, 'asc', 'totals').order, [1, 2, 0]);
});

test('ties keep the incoming order', () => {
  const tied = [row({ games: 1, yds: 100 }), row({ games: 1, yds: 100 })];
  assert.deepEqual(arrange(tied, yards, 'desc', 'totals').order, [0, 1]);
  assert.deepEqual(arrange(tied, yards, 'desc', 'totals').ranks, [1, 1]);
});

test('cells format by column and view', () => {
  assert.equal(formatCell(1234, yards, 'totals'), '1234');
  assert.equal(formatCell(61.7, yards, 'perGame'), '61.7');
  assert.equal(formatCell(4.8, ypc, 'totals'), '4.8');
  assert.equal(formatCell(0.692, pct, 'totals'), '69.2%');
  assert.equal(formatCell(null, pct, 'totals'), '-');
});

test('a capped board keeps the true top N for every column', () => {
  const sacks: ColumnSpec = { key: 'sk', format: 'decimal1', perGame: true, rate: false, better: 'high' };
  const ints: ColumnSpec = { key: 'int', format: 'integer', perGame: true, rate: false, better: 'high' };
  // Ranked by sacks. The interception leader (index 3) is last by sacks.
  const board = [
    row({ games: 2, sk: 4, int: 0 }),
    row({ games: 2, sk: 3, int: 0 }),
    row({ games: 2, sk: 2, int: 1 }),
    row({ games: 2, sk: 0, int: 3 }),
  ];
  const keep = rowsForTopN(board, [sacks, ints], 2);
  assert.deepEqual(keep, [0, 1, 2, 3]);
  const onlySacks = rowsForTopN(board, [sacks], 2);
  assert.deepEqual(onlySacks, [0, 1]);
});

test('capping shows only the first N and blanks the rest', () => {
  const capped = capArrangement(arrange(rows, yards, 'desc', 'totals'), 2);
  assert.deepEqual(capped.shown, [true, true, false]);
  assert.deepEqual(capped.ranks, [1, 2, null]);
});
