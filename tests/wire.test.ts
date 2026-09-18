import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  NO_FILTER,
  countByCategory,
  matches,
  parseFilter,
  serializeFilter,
  type WireRowSpec,
} from '../src/lib/wire/filter.ts';

const rows: WireRowSpec[] = [
  { team: 'DET', fromTeam: null, category: 'game-status', starter: true },
  { team: 'BUF', fromTeam: null, category: 'game-status', starter: true },
  { team: 'BUF', fromTeam: null, category: 'practice-report', starter: false },
  { team: 'DAL', fromTeam: 'ATL', category: 'team-change', starter: false },
];

test('no filter shows everything', () => {
  assert.equal(rows.filter((row) => matches(row, NO_FILTER)).length, 4);
});

test('team, category and starters combine', () => {
  const buf = { team: 'BUF', category: null, startersOnly: false };
  assert.equal(rows.filter((row) => matches(row, buf)).length, 2);
  assert.equal(rows.filter((row) => matches(row, { ...buf, category: 'game-status' })).length, 1);
  assert.equal(rows.filter((row) => matches(row, { ...NO_FILTER, startersOnly: true })).length, 2);
});

test('a player who left a team shows under that team as well', () => {
  const atl = { ...NO_FILTER, team: 'ATL' };
  assert.equal(rows.filter((row) => matches(row, atl)).length, 1);
});

test('category counts follow the team filter but not the category filter', () => {
  const counts = countByCategory(rows, { team: 'BUF', category: 'game-status', startersOnly: false });
  assert.deepEqual([...counts], [['game-status', 1], ['practice-report', 1]]);
});

test('filters round trip through the URL and ignore junk', () => {
  const teams = new Set(['BUF', 'DET']);
  const categories = new Set(['game-status', 'reserve']);
  const filter = { team: 'BUF', category: 'reserve', startersOnly: true };
  assert.equal(serializeFilter(filter), '?team=BUF&type=reserve&starters=1');
  assert.deepEqual(parseFilter(serializeFilter(filter), teams, categories), filter);
  assert.deepEqual(parseFilter('?team=buf', teams, categories), { ...NO_FILTER, team: 'BUF' });
  assert.deepEqual(parseFilter('?team=XYZ&type=bogus', teams, categories), NO_FILTER);
  assert.equal(serializeFilter(NO_FILTER), '');
});
