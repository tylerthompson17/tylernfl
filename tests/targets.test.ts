import assert from 'node:assert/strict';
import { test } from 'node:test';

import { shadeOf } from '../src/lib/targets/map.ts';

const cell = (targets: number, epaPerTarget: number | null, leagueEpaPerTarget: number | null) => ({
  targets,
  epaPerTarget,
  leagueEpaPerTarget,
});

test('under 3 targets is gray, whatever the rate', () => {
  assert.equal(shadeOf(cell(0, null, 0.4)), 'sparse');
  assert.equal(shadeOf(cell(2, 3.1, 0.4)), 'sparse');
  assert.notEqual(shadeOf(cell(3, 3.1, 0.4)), 'sparse');
});

test('shaded against the league in the same zone, not against zero', () => {
  // A deep cell at +0.4 is below a +0.744 league; a screen at -0.1 is above -0.249.
  assert.equal(shadeOf(cell(10, 0.4, 0.744)), 'loss-1');
  assert.equal(shadeOf(cell(10, -0.1, -0.249)), 'neutral');
  assert.equal(shadeOf(cell(10, 0.0, -0.249)), 'win-1');
});

test('steps start at 0.15, 0.4 and 0.8, edges included', () => {
  assert.equal(shadeOf(cell(5, 0.299, 0.15)), 'neutral');
  assert.equal(shadeOf(cell(5, 0.3, 0.15)), 'win-1');
  assert.equal(shadeOf(cell(5, 0.55, 0.15)), 'win-2');
  assert.equal(shadeOf(cell(5, 0.95, 0.15)), 'win-3');
  assert.equal(shadeOf(cell(5, -0.65, 0.15)), 'loss-3');
});

test('no league baseline means no shade', () => {
  assert.equal(shadeOf(cell(10, 0.5, null)), 'none');
});
