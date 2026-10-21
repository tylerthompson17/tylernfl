import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { advanceGames, type ScheduledGame } from '../../src/lib/live-ticker/schedule.ts';

// The page's games as ticker.json built them, and what each poll reports.
const week = (states: Record<string, ScheduledGame['state']>) =>
  new Map(Object.entries(states).map(([id, state]) => [id, { kickoff: null, state }]));
const poll = (states: Record<string, ScheduledGame['state']>) =>
  new Map(Object.entries(states).map(([id, state]) => [id, { state }]));

describe('advanceGames', () => {
  test("Thursday's final, already in the standings, is redrawn but not counted again", () => {
    const games = week({ thu: 'final', early: 'live', late: 'pre' });
    const out = advanceGames(games, poll({ thu: 'final', early: 'live', late: 'pre' }));
    assert.deepEqual(out.finished, []);
    assert.deepEqual(out.advanced, ['thu', 'early', 'late']);
  });

  test('a game that goes final during the visit is counted once, however many polls see it', () => {
    const games = week({ thu: 'final', early: 'live' });
    assert.deepEqual(advanceGames(games, poll({ thu: 'final', early: 'final' })).finished, ['early']);
    assert.deepEqual(advanceGames(games, poll({ thu: 'final', early: 'final' })).finished, []);
    assert.equal(games.get('early')!.state, 'final');
  });

  test('the catch-up request after a night game counts only that game, not the whole week', () => {
    const games = week({ thu: 'final', sun1: 'final', sun2: 'final', mnf: 'pre' });
    const out = advanceGames(games, poll({ thu: 'final', sun1: 'final', sun2: 'final', mnf: 'final' }));
    assert.deepEqual(out.finished, ['mnf']);
  });

  test('a pre-game the poll already shows final is counted (a page loaded before kickoff)', () => {
    const games = week({ sun: 'pre' });
    assert.deepEqual(advanceGames(games, poll({ sun: 'final' })).finished, ['sun']);
  });

  test('games never move backwards, and games the page does not show are ignored', () => {
    const games = week({ a: 'final', b: 'live' });
    const out = advanceGames(games, poll({ a: 'live', b: 'pre', other: 'final' }));
    assert.deepEqual(out, { advanced: [], finished: [] });
    assert.equal(games.get('a')!.state, 'final');
    assert.equal(games.get('b')!.state, 'live');
  });
});
