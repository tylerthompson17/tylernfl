import assert from 'node:assert/strict';
import { test } from 'node:test';

import { pageOf, step } from '../src/lib/live-fourth/paging.ts';

const ids = ['g', 'f', 'e', 'd', 'c', 'b', 'a'];

test('newest page follows new plays; an older page stays put', () => {
  assert.deepEqual(pageOf(ids, null, 3), { start: 0, label: '1 to 3 of 7', hasNewer: false, hasOlder: true });
  const older = step(ids, pageOf(ids, null, 3), 3, 1);
  assert.equal(older, 'd');
  assert.deepEqual(pageOf(ids, older, 3), { start: 3, label: '4 to 6 of 7', hasNewer: true, hasOlder: true });
  // Two new 4th downs arrive: the older page still starts at d.
  const more = ['i', 'h', ...ids];
  assert.equal(pageOf(more, older, 3).start, 5);
  assert.equal(step(ids, pageOf(ids, 'a', 3), 3, -1), 'd');
  assert.equal(step(ids, pageOf(ids, 'd', 3), 3, -1), null);
  assert.deepEqual(pageOf([], null, 3), { start: 0, label: '', hasNewer: false, hasOlder: false });
});
