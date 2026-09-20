import assert from 'node:assert/strict';
import { test } from 'node:test';

import { notablePerformances, type WeekLine } from '../src/lib/performances/notable.ts';

function line(board: string, player: string, values: Record<string, number | null>, home = true): WeekLine {
  return { playerId: `id-${player}`, player, team: 'BUF', opponent: 'DET', home, board, values };
}

test('one row per category, in category order', () => {
  const rows = notablePerformances([
    line('kicking', 'Chad Ryland', { fg_made: 4, fg_long: 49 }),
    line('rushing', 'Derrick Henry', { rushing_yards: 144, rushing_tds: 3 }),
    line('passing', 'Tyler Shough', { passing_yards: 410, passing_tds: 3 }),
  ]);

  assert.deepEqual(
    rows.map((row) => [row.label, row.player, row.line]),
    [
      ['Passing', 'Tyler Shough', '410 pass yds, 3 TD vs DET'],
      ['Rushing', 'Derrick Henry', '144 rush yds, 3 TD vs DET'],
      ['Kicking', 'Chad Ryland', '4 FG, long 49 vs DET'],
    ]
  );
});

test('a game under the bar is not notable, however far it leads', () => {
  const rows = notablePerformances([
    line('rushing', 'Best of a quiet week', { rushing_yards: 99, rushing_tds: 2 }),
    line('passing', 'Also quiet', { passing_yards: 299, passing_tds: 3 }),
  ]);
  assert.deepEqual(rows, []);
});

test('the bar itself counts', () => {
  const rows = notablePerformances([line('rushing', 'Exactly 100', { rushing_yards: 100, rushing_tds: 0 })]);
  assert.deepEqual(
    rows.map((row) => row.line),
    ['100 rush yds vs DET']
  );
});

test('ties break on the second stat, then on the name, so builds repeat', () => {
  const tied = [
    line('receiving', 'B Player', { receiving_yards: 120, receiving_tds: 1 }),
    line('receiving', 'A Player', { receiving_yards: 120, receiving_tds: 2 }),
    line('receiving', 'C Player', { receiving_yards: 120, receiving_tds: 2 }),
  ];
  assert.equal(notablePerformances(tied)[0]!.player, 'A Player');
  assert.equal(notablePerformances([...tied].reverse())[0]!.player, 'A Player');
});

test('a scoreless line reads as yards alone, and the road says at', () => {
  const rows = notablePerformances([
    line('receiving', 'Chris Olave', { receiving_yards: 182, receiving_tds: 0 }, false),
  ]);
  assert.equal(rows[0]!.line, '182 rec yds at DET');
});

test('sacks read in halves and pick up takeaways', () => {
  const rows = notablePerformances([
    line('defense', 'T.J. Watt', { def_sacks: 2, def_qb_hits: 1, def_interceptions: 1 }),
    line('defense', 'Nobody', { def_sacks: 1.5, def_qb_hits: 4, def_interceptions: 0 }),
  ]);
  assert.deepEqual(
    rows.map((row) => [row.label, row.player, row.line]),
    [['Sacks', 'T.J. Watt', '2.0 sacks, 1 INT vs DET']]
  );
});

test('equal sacks go to the takeaway before the QB hits, which the line hides', () => {
  const rows = notablePerformances([
    line('defense', 'More hits', { def_sacks: 2, def_qb_hits: 5, def_interceptions: 0 }),
    line('defense', 'Took the ball', { def_sacks: 2, def_qb_hits: 2, def_interceptions: 1 }),
  ]);
  assert.equal(rows[0]!.player, 'Took the ball');
});

test('half sacks keep their half, and a sack-only game says just that', () => {
  const rows = notablePerformances([line('defense', 'Somebody', { def_sacks: 2.5, def_qb_hits: 3 })]);
  assert.equal(rows[0]!.line, '2.5 sacks vs DET');
});

test('no games logged is no rows, not an error', () => {
  assert.deepEqual(notablePerformances([]), []);
});
