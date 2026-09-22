import assert from 'node:assert/strict';
import { test } from 'node:test';

import { record, tieNotes } from '../src/lib/standings/ties.ts';
import type { TeamStanding, TiebreakStep } from '../src/data/types.ts';

function team(abbr: string, wins: number, losses: number, divisionTiebreak: TiebreakStep | null = null, ties = 0): TeamStanding {
  return {
    team: abbr, conference: 'AFC', division: 'AFC East', wins, losses, ties, pct: 0,
    pointsFor: 0, pointsAgainst: 0, diff: 0, divisionRecord: [0, 0, 0], conferenceRecord: [0, 0, 0],
    streak: null, divisionRank: 1, conferenceRank: 1, divisionTiebreak, conferenceTiebreak: null,
  };
}

test('records show ties only when there are any', () => {
  assert.equal(record({ wins: 10, losses: 7, ties: 0 }), '10-7');
  assert.equal(record({ wins: 9, losses: 7, ties: 1 }), '9-7-1');
});

test('two teams on the same record: who is ahead, and on what', () => {
  const notes = tieNotes(
    [team('BUF', 11, 6), team('MIA', 10, 7, 'head_to_head'), team('NYJ', 10, 7, 'head_to_head'), team('NE', 4, 13)],
    'divisionTiebreak'
  );
  assert.deepEqual(notes, ['MIA and NYJ are both 10-7; MIA is ahead on head-to-head.']);
});

test('three or more, or more than one step, lists the steps in order', () => {
  const notes = tieNotes(
    [team('BAL', 1, 1, 'conference_record'), team('CLE', 1, 1, 'coin_toss'), team('PIT', 1, 1, 'coin_toss')],
    'divisionTiebreak'
  );
  assert.deepEqual(notes, ['BAL, CLE and PIT are all 1-1; order set by conference record, then coin toss.']);
});

test('the same record with nothing to break says nothing', () => {
  assert.deepEqual(tieNotes([team('BUF', 2, 0), team('MIA', 2, 0)], 'divisionTiebreak'), []);
});
