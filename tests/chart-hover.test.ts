import assert from 'node:assert/strict';
import { test } from 'node:test';

import { nearestIndex, stepIndex, toSvg, type ChartHover } from '../src/lib/charts/hover.ts';

// A 600 x 300 plot starting at (70, 10); minutes 0 to 60 across, 0 to 1 up.
const wp: ChartHover = {
  plot: { x: 70, y: 10, width: 600, height: 300 },
  xRange: [0, 60],
  yRange: [0, 1],
  mode: 'x',
  points: [
    { x: 0, y: 0.5, lines: ['Kickoff'] },
    { x: 15, y: 0.75, lines: ['Q2 15:00'] },
    { x: 15, y: 0.8, lines: ['Q2 15:00, after the kick'] },
    { x: 60, y: 1, lines: ['Final'] },
  ],
};

test('points map into the plot area, bottom to top', () => {
  assert.deepEqual(toSvg(wp, wp.points[0]!), { x: 70, y: 160 });
  assert.deepEqual(toSvg(wp, wp.points[3]!), { x: 670, y: 10 });
  assert.deepEqual(toSvg(wp, { x: 30, y: null, lines: [] }), { x: 370, y: null });
});

test('an inverted axis just runs the other way', () => {
  const inverted: ChartHover = { ...wp, yRange: [1, 0] };
  assert.equal(toSvg(inverted, { x: 0, y: 1, lines: [] }).y, 310);
});

test('along x the nearest point wins, and a shared place goes to the last', () => {
  assert.equal(nearestIndex(wp, 80, 0), 0);
  assert.equal(nearestIndex(wp, 220, 999), 2);
  assert.equal(nearestIndex(wp, 2000, 0), 3);
});

test('a scatter snaps to the nearest point in both directions', () => {
  const scatter: ChartHover = {
    ...wp,
    mode: 'nearest',
    points: [
      { x: 10, y: 0.9, lines: ['A'] },
      { x: 11, y: 0.1, lines: ['B'] },
    ],
  };
  const low = toSvg(scatter, scatter.points[1]!);
  assert.equal(nearestIndex(scatter, low.x - 5, low.y! - 5), 1);
});

test('arrow keys, Home and End step through the points', () => {
  assert.equal(stepIndex('ArrowRight', -1, 4), 0);
  assert.equal(stepIndex('ArrowLeft', -1, 4), 3);
  assert.equal(stepIndex('ArrowRight', 3, 4), 3);
  assert.equal(stepIndex('ArrowLeft', 0, 4), 0);
  assert.equal(stepIndex('End', 1, 4), 3);
  assert.equal(stepIndex('Home', 3, 4), 0);
  assert.equal(stepIndex('a', 1, 4), null);
  assert.equal(stepIndex('Home', -1, 0), null);
});
