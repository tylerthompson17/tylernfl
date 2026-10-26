import assert from 'node:assert/strict';
import { test } from 'node:test';

import { callsWeek, homeState, homeWeek } from '../src/lib/home/state.ts';
import { allWidths, moreCounts, rendered, rowsClass } from '../src/lib/home/rows.ts';

// Week 2 of 2026: Thursday night, then Sunday.
const schedule = [
  { kickoff: '2026-09-18T00:15:00Z' }, // Thursday 8:15 PM Eastern
  { kickoff: '2026-09-20T17:00:00Z' }, // Sunday 1 PM
  { kickoff: '2026-09-22T00:15:00Z' }, // Monday 8:15 PM
];
const final = { state: 'final' as const };
const pre = { state: 'pre' as const };

test('a day with a kickoff is a game day, whatever the ticker shows', () => {
  assert.equal(homeState(new Date('2026-09-20T18:30:00Z'), schedule, [final, pre]), 'gameday');
  // Thursday night, 10 PM Eastern, is still Thursday.
  assert.equal(homeState(new Date('2026-09-18T02:00:00Z'), schedule, [pre]), 'gameday');
  // Monday morning before the Monday night game.
  assert.equal(homeState(new Date('2026-09-21T14:00:00Z'), schedule, [final, pre]), 'gameday');
});

test('no kickoff today: recap when the ticker is all final, preview when not', () => {
  assert.equal(homeState(new Date('2026-09-22T14:00:00Z'), schedule, [final, final]), 'recap');
  assert.equal(homeState(new Date('2026-09-23T16:00:00Z'), schedule, [pre, pre]), 'preview');
});

test('an empty ticker is the offseason', () => {
  assert.equal(homeState(new Date('2026-06-15T16:00:00Z'), schedule, []), 'offseason');
});

test('the home week is the latest complete week', () => {
  assert.equal(homeWeek([1, 2, 3]), 3);
  assert.equal(homeWeek([]), null);
});

test('calls come from the home week, or the latest earlier week with grades', () => {
  assert.equal(callsWeek(3, [1, 2, 3, 4]), 3);
  assert.equal(callsWeek(3, [1, 2]), 2);
  assert.equal(callsWeek(3, []), null);
  assert.equal(callsWeek(null, [1]), null);
});

test('rows: classes, what to render, and how many more at each width', () => {
  const r = { wide: 6, mid: 10, phone: 3 };
  assert.equal(rowsClass(r), 'rows w6 m10 p3');
  assert.equal(rendered(r), 10);
  assert.deepEqual(moreCounts(r, 10, 25), { wide: 19, mid: 15, phone: 22 });
  // A short list: everything listed shows, the rest of the page is more.
  assert.deepEqual(moreCounts(r, 4, 30), { wide: 26, mid: 26, phone: 27 });
  assert.deepEqual(moreCounts(r, 4, 4), { wide: 0, mid: 0, phone: 1 });
  assert.deepEqual(allWidths(5), { wide: 5, mid: 5, phone: 5 });
});
