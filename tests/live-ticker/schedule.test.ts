import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { isAdvance, pollWindow, retryDelay } from '../../src/lib/live-ticker/schedule.ts';

const thursday = new Date('2026-09-18T00:15:00Z');
const sunday = new Date('2026-09-20T17:00:00Z');
const minutes = (n: number) => n * 60_000;
const at = (base: Date, offset: number) => new Date(base.getTime() + offset);

describe('pollWindow', () => {
  const week = [
    { kickoff: thursday, state: 'pre' as const },
    { kickoff: sunday, state: 'pre' as const },
  ];

  test('waits until 15 minutes before the next kickoff', () => {
    assert.deepEqual(pollWindow(week, at(thursday, -minutes(60))), {
      active: false,
      nextStart: at(thursday, -minutes(15)),
    });
  });

  test('polls from 15 minutes before kickoff to 4.5 hours after', () => {
    assert.equal(pollWindow(week, at(thursday, -minutes(15))).active, true);
    assert.equal(pollWindow(week, at(thursday, minutes(270))).active, true);
    assert.equal(pollWindow(week, at(thursday, minutes(271))).active, false);
  });

  test('does not poll between Thursday and Sunday', () => {
    assert.deepEqual(pollWindow(week, at(thursday, minutes(600))), {
      active: false,
      nextStart: at(sunday, -minutes(15)),
    });
  });

  test('final games and games without a kickoff never poll', () => {
    const done = [
      { kickoff: thursday, state: 'final' as const },
      { kickoff: null, state: 'pre' as const },
    ];
    assert.deepEqual(pollWindow(done, thursday), { active: false, nextStart: null });
  });
});

describe('retryDelay', () => {
  test('doubles from the poll interval and caps at 5 minutes', () => {
    assert.equal(retryDelay(0), 30_000);
    assert.equal(retryDelay(1), 60_000);
    assert.equal(retryDelay(3), 240_000);
    assert.equal(retryDelay(10), 300_000);
  });
});

describe('isAdvance', () => {
  test('games only move forward', () => {
    assert.equal(isAdvance('pre', 'live'), true);
    assert.equal(isAdvance('live', 'live'), true);
    assert.equal(isAdvance('final', 'live'), false);
    assert.equal(isAdvance('live', 'pre'), false);
  });
});
