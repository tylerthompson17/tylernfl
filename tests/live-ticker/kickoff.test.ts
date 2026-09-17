import assert from 'node:assert/strict';
import { test } from 'node:test';

import { formatKickoff } from '../../src/lib/live-ticker/kickoff.ts';

const detAtBuf = '2026-09-18T00:15:00Z';

test('kickoff in the visitor time zone', () => {
  assert.equal(formatKickoff(detAtBuf, 'en-US', 'America/New_York'), 'Thu 8:15 PM');
  assert.equal(formatKickoff(detAtBuf, 'en-US', 'America/Los_Angeles'), 'Thu 5:15 PM');
});

test('kickoff can fall on a different day and use the visitor locale', () => {
  assert.equal(formatKickoff(detAtBuf, 'en-GB', 'Europe/London'), 'Fri 01:15');
});

test('invalid timestamps are skipped', () => {
  assert.equal(formatKickoff('not a date', 'en-US', 'UTC'), null);
});
