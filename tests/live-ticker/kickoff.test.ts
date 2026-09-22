import assert from 'node:assert/strict';
import { test } from 'node:test';

import { formatKickoff, formatKickoffDate } from '../../src/lib/live-ticker/kickoff.ts';

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

test('dated kickoffs for team pages, in the zone asked for', () => {
  assert.equal(formatKickoffDate('2026-09-27T17:00:00Z', 'datetime', 'en-US', 'America/New_York'), 'Sun, Sep 27, 1:00 PM');
  assert.equal(formatKickoffDate('2026-09-27T17:00:00Z', 'date', 'en-US', 'America/New_York'), 'Sun, Sep 27');
  // A Sunday night game is Monday morning in Tokyo.
  assert.equal(formatKickoffDate('2026-09-28T00:20:00Z', 'date', 'en-US', 'Asia/Tokyo'), 'Mon, Sep 28');
  assert.equal(formatKickoffDate('not a date'), null);
});
