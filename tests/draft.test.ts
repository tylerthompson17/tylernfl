import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { DraftOrderData, DraftPick } from '../src/data/types.ts';
import {
  choiceLine,
  dataDate,
  dataLine,
  draftState,
  groupWords,
  isOld,
  ownerNote,
  projectedOwnerNote,
  tiebreakWords,
} from '../src/lib/draft/view.ts';

function data(over: Partial<DraftOrderData> = {}): DraftOrderData {
  return {
    draft: 2027,
    season: 2026,
    throughWeek: 6,
    updated: '2026-10-22T21:24:18Z',
    stage: 'regular_season',
    picks: [],
    projected: null,
    ...over,
  };
}

const now = new Date('2026-10-23T12:00:00Z');

test('no file is the missing state, never an error', () => {
  assert.deepEqual(draftState(null, now, 2026), { kind: 'missing' });
  assert.deepEqual(draftState(undefined, now, 2026), { kind: 'missing' });
  assert.equal(dataLine({ kind: 'missing' }), '');
});

test('a fresh file is ready and says its date', () => {
  const state = draftState(data(), now, 2026);
  assert.equal(state.kind, 'ready');
  assert.equal('stale' in state && state.stale, false);
  assert.equal(dataLine(state), 'Data from October 22, 2026.');
});

test('a file over 36 hours old, from an earlier season, or with a bad date is behind', () => {
  const later = new Date('2026-10-24T12:00:00Z');
  assert.match(dataLine(draftState(data(), later, 2026)), /not the latest daily update/);
  assert.match(dataLine(draftState(data(), now, 2027)), /not the latest daily update/);
  assert.match(dataLine(draftState(data({ updated: 'garbage' }), now, 2026)), /not the latest/);
});

test('before the first game the file is the not started state', () => {
  assert.equal(draftState(data({ stage: 'not_started' }), now, 2026).kind, 'not_started');
});

test('the data date is the Eastern date', () => {
  // 2 AM UTC on the 23rd is still the evening of the 22nd in New York.
  assert.equal(dataDate('2026-10-23T02:00:00Z'), 'October 22, 2026');
});

const pick = (over: Partial<DraftPick>): DraftPick => ({
  pick: 1, team: 'LAC', owner: 'LAC', choice: null, group: 'non_playoff', wins: 0, losses: 6, ties: 0,
  pct: 0, sos: 0.629, tiebreak: null, coinFlip: false, ...over,
});

test('tiebreaks in words', () => {
  assert.equal(tiebreakWords(pick({ tiebreak: 'strength_of_schedule' })), 'Strength of schedule');
  assert.equal(tiebreakWords(pick({ tiebreak: 'common_games' })), 'Record in common games');
  assert.equal(tiebreakWords(pick({ tiebreak: 'coin_toss', coinFlip: true })), 'Coin flip, still to come');
  assert.equal(tiebreakWords(pick({})), '');
});

test('who holds a pick', () => {
  assert.equal(ownerNote(pick({})), null);
  assert.equal(ownerNote(pick({ team: 'IND', owner: 'NYJ' })), 'NYJ hold it');
  const choice = { between: ['DAL', 'GB'] as [string, string], takes: 'earlier' as const, to: 'NYJ' };
  assert.equal(ownerNote(pick({ team: 'DAL', owner: 'NYJ', choice })),
    "NYJ hold it: NYJ get the earlier of DAL's and GB's picks");
  assert.equal(ownerNote(pick({ team: 'GB', owner: 'DAL', choice })),
    "DAL hold it for now; NYJ get it instead if it lands before DAL's pick");
  assert.equal(ownerNote(pick({ team: 'DAL', owner: 'DAL', choice })),
    "DAL hold it for now; NYJ get it instead if it lands before GB's pick");
  assert.equal(ownerNote(pick({ team: 'GB', owner: 'DAL', choice }), true),
    "DAL hold it: NYJ got the earlier of the two, DAL's");
  assert.equal(projectedOwnerNote({ team: 'DAL', owner: null }), 'Owner depends on where it lands');
  assert.equal(projectedOwnerNote({ team: 'IND', owner: 'NYJ' }), 'NYJ hold it');
});

test('status says where a team stands today until the playoffs decide it', () => {
  assert.equal(groupWords('non_playoff', 'regular_season'), 'Outside the playoff places');
  assert.equal(groupWords('alive', 'regular_season'), 'In a playoff place');
  assert.equal(groupWords('non_playoff', 'playoffs'), 'Missed the playoffs');
  assert.equal(groupWords('wild_card', 'final'), 'Out in the wild card round');
});

test('the browser applies the same 36 hour rule', () => {
  assert.equal(isOld('2026-10-22T21:24:18Z', new Date('2026-10-24T09:24:18Z')), false); // exactly 36 hours
  assert.equal(isOld('2026-10-22T21:24:18Z', new Date('2026-10-24T09:24:19Z')), true);
  assert.equal(isOld('', now), true);
});

test('a choice in the projection', () => {
  const c = { between: ['DAL', 'GB'] as [string, string], takes: 'earlier', to: 'NYJ', chances: { DAL: 0.744, GB: 0.256 } };
  assert.equal(choiceLine(c, (a) => a, (p) => `${Math.round(p * 100)}%`),
    "NYJ get the earlier of DAL's and GB's picks: DAL's 74% of the time, GB's 26%.");
});
