import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { TargetCell, TargetGrid } from '../src/data/types.ts';
import { bestAndWorst, depthShares, shadeOf, signed2, vsLeague } from '../src/lib/targets/map.ts';

const cell = (targets: number, epaPerTarget: number | null, leagueEpaPerTarget: number | null) => ({
  targets,
  epaPerTarget,
  leagueEpaPerTarget,
});

test('under 5 targets is unshaded and has no EPA, whatever the rate', () => {
  assert.equal(shadeOf(cell(0, null, 0.4)), 'sparse');
  assert.equal(shadeOf(cell(4, 3.1, 0.4)), 'sparse');
  assert.equal(vsLeague(cell(4, 3.1, 0.4)), null);
  assert.notEqual(shadeOf(cell(5, 3.1, 0.4)), 'sparse');
});

test('under 10 targets gets the lighter shade at most', () => {
  assert.equal(shadeOf(cell(9, 3.1, 0.4)), 'win-1');
  assert.equal(shadeOf(cell(9, -2.0, 0.4)), 'loss-1');
  assert.equal(shadeOf(cell(10, 3.1, 0.4)), 'win-2');
});

test('shaded against the league in the same zone, not against zero', () => {
  // A deep cell at +0.4 is below a +0.744 league; a screen at -0.1 is above -0.249.
  assert.equal(shadeOf(cell(10, 0.4, 0.744)), 'loss-1');
  assert.equal(shadeOf(cell(10, -0.1, -0.249)), 'neutral');
  assert.equal(shadeOf(cell(10, 0.0, -0.249)), 'win-1');
});

test('two steps each way, at 0.15 and 0.5, edges included', () => {
  assert.equal(shadeOf(cell(10, 0.299, 0.15)), 'neutral');
  assert.equal(shadeOf(cell(10, 0.3, 0.15)), 'win-1');
  assert.equal(shadeOf(cell(10, 0.649, 0.15)), 'win-1');
  assert.equal(shadeOf(cell(10, 0.65, 0.15)), 'win-2');
  assert.equal(shadeOf(cell(10, 3.0, 0.15)), 'win-2');
  assert.equal(shadeOf(cell(10, 0.0, 0.15)), 'loss-1');
  assert.equal(shadeOf(cell(10, -0.35, 0.15)), 'loss-2');
});

test('no league baseline means no shade and no EPA difference', () => {
  assert.equal(shadeOf(cell(10, 0.5, null)), 'none');
  assert.equal(vsLeague(cell(10, 0.5, null)), null);
});

test('differences read to two places with a true minus sign', () => {
  assert.equal(signed2(0.214), '+0.21');
  assert.equal(signed2(-0.6), '−0.60');
  assert.equal(signed2(0.004), '0.00');
});

const full = (location: TargetCell['location'], depth: TargetCell['depth'], targets: number, epa: number | null, league = 0): TargetCell => ({
  location, depth, targets, receptions: 0, catchRate: targets ? 0 : null, yards: 0, touchdowns: 0,
  interceptions: 0, epaPerTarget: epa, leagueEpaPerTarget: league,
});

const gridOf = (cells: TargetCell[]): TargetGrid => ({
  total: { targets: cells.reduce((s, c) => s + c.targets, 0), receptions: 0, catchRate: 0, yards: 0, touchdowns: 0, interceptions: 0, epaPerTarget: 0 },
  cells,
});

test('best and worst zone skip cells too small to compare; ties go to more targets', () => {
  const grid = gridOf([
    full('left', 'deep', 4, 3.0),       // too small, however good
    full('middle', 'deep', 5, 0.5),
    full('right', 'short', 9, 0.5),     // ties middle deep on more targets
    full('left', 'short', 8, -0.4),
    full('right', 'behind', 5, -0.4),
  ]);
  const { best, worst } = bestAndWorst(grid);
  assert.deepEqual([best?.location, best?.depth], ['right', 'short']);
  assert.deepEqual([worst?.location, worst?.depth], ['left', 'short']);
});

test('one comparable zone is the best and there is no worst; none gives neither', () => {
  assert.equal(bestAndWorst(gridOf([full('left', 'deep', 5, 0.1)])).worst, null);
  assert.deepEqual(bestAndWorst(gridOf([full('left', 'deep', 4, 0.1)])), { best: null, worst: null });
});

test('share by depth sums each band across zones, beside the league', () => {
  const grid = gridOf([full('left', 'deep', 1, 0), full('right', 'deep', 1, 0), full('middle', 'short', 6, 0)]);
  const shares = depthShares(grid, { deep: 0.12, intermediate: 0.21, short: 0.49, behind: 0.18 });
  assert.deepEqual(shares.map((s) => [s.depth.depth, s.targets, s.share, s.league]), [
    ['deep', 2, 0.25, 0.12], ['intermediate', 0, 0, 0.21], ['short', 6, 0.75, 0.49], ['behind', 0, 0, 0.18],
  ]);
});
