import assert from 'node:assert/strict';
import { test } from 'node:test';

import { formatChance, oddsLabel } from '../src/lib/teams/odds.ts';

test('chances never claim a team is certainly in or out', () => {
  assert.equal(formatChance(0), '<1%');
  assert.equal(formatChance(0.004), '<1%');
  assert.equal(formatChance(0.005), '1%');
  assert.equal(formatChance(0.68), '68%');
  assert.equal(formatChance(0.994), '99%');
  assert.equal(formatChance(0.995), '>99%');
  assert.equal(formatChance(1), '>99%');
});

test('the label says where the probabilities come from', () => {
  assert.equal(oddsLabel(15, 240), "Based on betting lines for next week's games; later games are even odds.");
  assert.match(oddsLabel(0, 240), /no remaining game has a line yet/);
  assert.equal(oddsLabel(0, 0), 'The regular season is over.');
});
