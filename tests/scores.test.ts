import assert from 'node:assert/strict';
import { test } from 'node:test';

import { TBD_LABEL, scoreSlots } from '../src/lib/scores/slots.ts';
import type { TickerGame } from '../src/data/types.ts';

function game(away: string, home: string, kickoff: string | null): TickerGame {
  return {
    id: `2026_02_${away}_${home}`,
    away,
    home,
    awayScore: null,
    homeScore: null,
    state: 'pre',
    detail: '',
    kickoff,
    espnId: null,
  };
}

const SUN_EARLY = '2026-09-20T17:00:00Z';
const SUN_LATE = '2026-09-20T20:05:00Z';
const THU = '2026-09-18T00:15:00Z';

test('games sharing a kickoff share a slot, in kickoff order', () => {
  const slots = scoreSlots([
    game('GB', 'NYJ', SUN_LATE),
    game('CAR', 'ATL', SUN_EARLY),
    game('DET', 'BUF', THU),
    game('MIN', 'CHI', SUN_EARLY),
  ]);

  assert.deepEqual(
    slots.map((slot) => slot.games.map((g) => `${g.away}@${g.home}`)),
    [['DET@BUF'], ['CAR@ATL', 'MIN@CHI'], ['GB@NYJ']]
  );
});

test('slots are labelled in Eastern time, the convention the pipeline writes', () => {
  // Thursday night kicks off the next day in UTC, so the label has to come
  // from the Eastern date, not from the timestamp's own day.
  const slots = scoreSlots([game('CAR', 'ATL', SUN_EARLY), game('DET', 'BUF', THU)]);
  assert.deepEqual(
    slots.map((slot) => slot.label),
    ['Thu 8:15 PM', 'Sun 1:00 PM']
  );
});

test('games without a kickoff group together and sort last', () => {
  const slots = scoreSlots([game('JAX', 'DEN', null), game('CAR', 'ATL', SUN_EARLY), game('LV', 'LAC', null)]);
  assert.equal(slots.length, 2);
  assert.equal(slots[1]!.label, TBD_LABEL);
  assert.equal(slots[1]!.kickoff, null);
  assert.deepEqual(slots[1]!.games.map((g) => g.away), ['JAX', 'LV']);
});
