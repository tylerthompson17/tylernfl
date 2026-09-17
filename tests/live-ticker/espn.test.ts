import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import { inProgressDetail, parseEvent, parseScoreboard, scoreboardParams } from '../../src/lib/live-ticker/espn.ts';

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../fixtures/espn/${name}`, import.meta.url), 'utf8'));

describe('scoreboardParams', () => {
  test('regular season weeks map directly', () => {
    assert.deepEqual(scoreboardParams(2026, 2), { dates: '2026', seasontype: '2', week: '2' });
  });

  test('postseason rounds skip the Pro Bowl week', () => {
    assert.equal(scoreboardParams(2025, 19).week, '1');
    assert.equal(scoreboardParams(2025, 21).week, '3');
    assert.deepEqual(scoreboardParams(2025, 22), { dates: '2025', seasontype: '3', week: '5' });
  });
});

describe('parseScoreboard with real responses', () => {
  test('finished week: final scores and overtime', () => {
    const games = parseScoreboard(fixture('scoreboard-2026-week1-final.json'), 2026, 1);
    assert.ok(games);
    assert.equal(games.size, 16);
    // NO at DET went to overtime; SF vs LAR (neutral site) did not.
    assert.deepEqual(games.get('401872923'), { state: 'final', awayScore: 30, homeScore: 31, detail: 'Final/OT' });
    assert.deepEqual(games.get('401872657'), { state: 'final', awayScore: 27, homeScore: 7, detail: 'Final' });
  });

  test('scheduled week: no scores and no ESPN kickoff text', () => {
    const games = parseScoreboard(fixture('scoreboard-2026-week2-scheduled.json'), 2026, 2);
    assert.ok(games);
    assert.equal(games.size, 16);
    assert.deepEqual(games.get('401872932'), { state: 'pre', awayScore: null, homeScore: null, detail: null });
  });

  test('a response for a different week is rejected', () => {
    assert.equal(parseScoreboard(fixture('scoreboard-2026-week1-final.json'), 2026, 2), null);
    assert.equal(parseScoreboard(fixture('scoreboard-2026-week1-final.json'), 2025, 1), null);
  });
});

describe('parse failures', () => {
  test('unexpected shapes return null', () => {
    assert.equal(parseScoreboard(null, 2026, 1), null);
    assert.equal(parseScoreboard({ events: [] }, 2026, 1), null);
    assert.equal(parseEvent({ id: '1', status: {} }), null);
    assert.equal(parseEvent({ id: '1', status: { type: {} }, competitions: [{ competitors: [] }] }), null);
  });

  test('postponed games stay upcoming with ESPN status text', () => {
    const event = {
      id: '1',
      status: { period: 0, type: { name: 'STATUS_POSTPONED', state: 'post', completed: false, description: 'Postponed' } },
      competitions: [{ competitors: [{ homeAway: 'away', score: '0' }, { homeAway: 'home', score: '0' }] }],
    };
    assert.deepEqual(parseEvent(event), ['1', { state: 'pre', awayScore: null, homeScore: null, detail: 'Postponed' }]);
  });
});

// PROVISIONAL: synthetic statuses based on ESPN's documented names. Replace
// with the real in-progress fixture captured during DET at BUF (2026-09-17).
describe('in-progress detail (provisional)', () => {
  const status = (name: string, period: number, displayClock = '0:00') => ({
    period,
    displayClock,
    type: { name, state: 'in', completed: false, shortDetail: 'fallback text' },
  });

  test('quarter and clock', () => {
    assert.equal(inProgressDetail(status('STATUS_IN_PROGRESS', 3, '8:45')), 'Q3 8:45');
    assert.equal(inProgressDetail(status('STATUS_IN_PROGRESS', 5, '6:02')), 'OT 6:02');
  });

  test('halftime and end of quarter', () => {
    assert.equal(inProgressDetail(status('STATUS_HALFTIME', 2)), 'Half');
    assert.equal(inProgressDetail(status('STATUS_END_PERIOD', 1)), 'End Q1');
  });

  test('unknown in-progress statuses fall back to ESPN text', () => {
    assert.equal(inProgressDetail(status('STATUS_DELAYED', 2)), 'fallback text');
  });

  test('a live event parses scores', () => {
    const event = {
      id: '401872932',
      status: status('STATUS_IN_PROGRESS', 2, '4:12'),
      competitions: [{ competitors: [{ homeAway: 'home', score: '10' }, { homeAway: 'away', score: '14' }] }],
    };
    assert.deepEqual(parseEvent(event), ['401872932', { state: 'live', awayScore: 14, homeScore: 10, detail: 'Q2 4:12' }]);
  });
});
