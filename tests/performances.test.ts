import assert from 'node:assert/strict';
import { test } from 'node:test';

import { notablePerformances, percentileIn, type Pool, type WeekLine } from '../src/lib/performances/notable.ts';

function line(board: string, player: string, values: Record<string, number | null>, home = true): WeekLine {
  return { playerId: `id-${player}`, player, team: 'BUF', opponent: 'DET', home, board, values };
}

// Small made-up histories: 100 team games each.
const pool = (stat: string, values: [number, number][]): Pool => ({ stat, games: 100, values });
const POOLS: Record<string, Pool> = {
  passing: pool('passing_yards', [[200, 50], [300, 40], [400, 10]]),
  rushing: pool('rushing_yards', [[50, 60], [100, 30], [150, 10]]),
  receiving: pool('receiving_yards', [[60, 70], [100, 20], [150, 10]]),
  defense: pool('def_sacks', [[0, 40], [1, 40], [2, 15], [3, 5]]),
  kicking: pool('fg_made', [[1, 60], [2, 30], [4, 10]]),
};
const notable = (lines: WeekLine[], limit?: number) => notablePerformances(lines, POOLS, limit);

test('a percentile counts equal games as half', () => {
  assert.equal(percentileIn(POOLS.defense!, 2), (80 + 15 / 2) / 100);
  assert.equal(percentileIn(POOLS.passing!, 350), 0.9);
  assert.equal(percentileIn(POOLS.passing!, 527), 1);
  assert.equal(percentileIn(POOLS.kicking!, 0), 0);
});

test('ranked across categories by percentile, highest first', () => {
  const rows = notable([
    line('passing', 'Tyler Shough', { passing_yards: 310, passing_tds: 3 }),
    line('rushing', 'Derrick Henry', { rushing_yards: 160, rushing_tds: 3 }),
    line('defense', 'T.J. Watt', { def_sacks: 2, def_interceptions: 0 }),
    line('kicking', 'Chad Ryland', { fg_made: 4, fg_long: 49 }),
  ]);
  assert.deepEqual(
    rows.map((row) => [row.player, row.percentile]),
    [['Derrick Henry', 1], ['Chad Ryland', 0.95], ['Tyler Shough', 0.9], ['T.J. Watt', 0.875]]
  );
  assert.equal(rows[0]!.line, '160 rush yds, 3 TD vs DET');
});

test('one row per player, their best line', () => {
  const rows = notable([
    line('passing', 'Josh Allen', { passing_yards: 210, passing_tds: 1 }),
    line('rushing', 'Josh Allen', { rushing_yards: 110, rushing_tds: 2 }),
  ]);
  assert.deepEqual(rows.map((row) => [row.label, row.line]), [['Rushing', '110 rush yds, 2 TD vs DET']]);
});

test('at most the limit, and a line with none of its stat is left out', () => {
  const lines = ['A', 'B', 'C', 'D', 'E', 'F'].map((name, i) => line('receiving', name, { receiving_yards: 100 + i }));
  assert.equal(notable(lines).length, 5);
  assert.equal(notable(lines, 2).length, 2);
  assert.deepEqual(notable([line('defense', 'Nobody', { def_sacks: 0, def_qb_hits: 3 })]), []);
});

test('equal percentiles go to the category listed first, then the second stat, then the name', () => {
  const tied = [
    line('receiving', 'B Player', { receiving_yards: 120, receiving_tds: 1 }),
    line('receiving', 'A Player', { receiving_yards: 120, receiving_tds: 2 }),
    line('receiving', 'C Player', { receiving_yards: 120, receiving_tds: 2 }),
  ];
  assert.deepEqual(notable(tied).map((r) => r.player), ['A Player', 'C Player', 'B Player']);
  assert.deepEqual(notable([...tied].reverse()).map((r) => r.player), ['A Player', 'C Player', 'B Player']);
  // 120 receiving yards and 350 passing yards are both at 90%: passing is listed first.
  const across = notable([tied[0]!, line('passing', 'Z Passer', { passing_yards: 350, passing_tds: 0 })]);
  assert.deepEqual(across.map((r) => r.player), ['Z Passer', 'B Player']);
});

test('a scoreless line reads as yards alone, and the road says at', () => {
  const rows = notable([
    line('receiving', 'Chris Olave', { receiving_yards: 182, receiving_tds: 0 }, false),
  ]);
  assert.equal(rows[0]!.line, '182 rec yds at DET');
});

test('sacks read in halves and pick up takeaways', () => {
  const rows = notable([
    line('defense', 'T.J. Watt', { def_sacks: 2, def_qb_hits: 1, def_interceptions: 1 }),
    line('defense', 'Somebody', { def_sacks: 1.5, def_qb_hits: 4, def_interceptions: 0 }),
  ]);
  assert.deepEqual(
    rows.map((row) => [row.label, row.player, row.line]),
    [['Sacks', 'T.J. Watt', '2.0 sacks, 1 INT vs DET'], ['Sacks', 'Somebody', '1.5 sacks vs DET']]
  );
});

test('equal sacks go to the takeaway before the QB hits, which the line hides', () => {
  const rows = notable([
    line('defense', 'More hits', { def_sacks: 2, def_qb_hits: 5, def_interceptions: 0 }),
    line('defense', 'Took the ball', { def_sacks: 2, def_qb_hits: 2, def_interceptions: 1 }),
  ]);
  assert.equal(rows[0]!.player, 'Took the ball');
});

test('half sacks keep their half, and a sack-only game says just that', () => {
  const rows = notable([line('defense', 'Somebody', { def_sacks: 2.5, def_qb_hits: 3 })]);
  assert.equal(rows[0]!.line, '2.5 sacks vs DET');
});

test('no games logged is no rows, not an error', () => {
  assert.deepEqual(notable([]), []);
  assert.deepEqual(notablePerformances([line('passing', 'X', { passing_yards: 300 })], {}), []);
});
