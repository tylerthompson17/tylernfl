import assert from 'node:assert/strict';
import { test } from 'node:test';

import { callsWeek, homeState, homeWeek } from '../src/lib/home/state.ts';
import { allWidths, moreCounts, rendered, rowsClass } from '../src/lib/home/rows.ts';

// Week 7 of 2026: Thursday night, Sunday, Monday night; week 6 complete.
const g = (week: number, kickoff: string, final: boolean) => ({
  week,
  kickoff,
  awayScore: final ? 20 : null,
  homeScore: final ? 17 : null,
});
const SUN = '2026-10-25T17:00:00Z'; // Sunday 1 PM Eastern
const week6 = Array.from({ length: 14 }, () => g(6, '2026-10-18T17:00:00Z', true));
const final = { state: 'final' as const };
const pre = { state: 'pre' as const };

/** Week 7 as it stood at a moment: games that kicked off by then are final unless `live`. */
function week7(now: string, live: string[] = []) {
  const kickoffs = ['2026-10-23T00:15:00Z', ...Array.from({ length: 13 }, () => SUN), '2026-10-27T00:15:00Z'];
  return kickoffs.map((k) => g(7, k, new Date(k) <= new Date(now) && !live.includes(k)));
}

test('live from 15 minutes before a kickoff until the game is final', () => {
  const at = '2026-10-25T16:45:00Z';
  assert.equal(homeState(new Date(at), [...week6, ...week7(at)], [final, pre]), 'live');
  const during = '2026-10-25T18:30:00Z';
  assert.equal(homeState(new Date(during), [...week6, ...week7(during, [SUN])], [pre]), 'live');
  // Sunday morning, only Thursday's game played: a preview.
  const morning = '2026-10-25T14:00:00Z';
  assert.equal(homeState(new Date(morning), [...week6, ...week7(morning)], [final, pre]), 'preview');
});

test('the morning after a Sunday is a recap, even with Monday night still to play', () => {
  const monday = '2026-10-26T15:00:00Z'; // Monday 11 AM
  assert.equal(homeState(new Date(monday), [...week6, ...week7(monday)], [final, pre]), 'recap');
  const tuesday = '2026-10-27T14:00:00Z';
  assert.equal(homeState(new Date(tuesday), [...week6, ...week7(tuesday)], [final]), 'recap');
});

test('midweek, and the day after a lone Thursday game, are previews', () => {
  const wednesday = '2026-10-28T16:00:00Z';
  assert.equal(homeState(new Date(wednesday), [...week6, ...week7(wednesday)], [final]), 'preview');
  const friday = '2026-10-23T15:00:00Z';
  assert.equal(homeState(new Date(friday), [...week6, ...week7(friday)], [final, pre]), 'preview');
});

test('an empty ticker is the offseason', () => {
  assert.equal(homeState(new Date('2026-06-15T16:00:00Z'), week6, []), 'offseason');
});

test('the home week: complete, or three finals in', () => {
  assert.equal(homeWeek([...week6, ...week7('2026-10-26T15:00:00Z')]), 7); // Monday, 14 of 15 final
  assert.equal(homeWeek([...week6, ...week7('2026-10-23T15:00:00Z')]), 6); // Friday, 1 final
  assert.equal(homeWeek([g(22, '2027-02-08T23:30:00Z', true)]), 22); // a one-game week, complete
  assert.equal(homeWeek([g(1, '2026-09-10T00:20:00Z', false)]), null);
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
