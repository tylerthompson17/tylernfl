import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { applyFinals, nextStreak, recordText, winPct, type BaseRecord } from '../../src/lib/live-ticker/records.ts';

const team = (division: string, fields: Partial<BaseRecord> = {}): BaseRecord => ({
  division,
  conference: division.slice(0, 3),
  wins: 3,
  losses: 2,
  ties: 0,
  pointsFor: 120,
  pointsAgainst: 100,
  divisionRecord: [1, 0, 0],
  conferenceRecord: [2, 1, 0],
  streak: 'W2',
  ...fields,
});

const base = {
  BUF: team('AFC East'),
  MIA: team('AFC East', { wins: 1, losses: 4, streak: 'L3' }),
  DAL: team('NFC East', { streak: null }),
};

describe('applyFinals', () => {
  test('a division win moves every column for both teams', () => {
    const out = applyFinals(base, [{ away: 'MIA', home: 'BUF', awayScore: 17, homeScore: 27 }]);
    assert.deepEqual(recordText(out.get('BUF')!), {
      record: '4-2', w: '4', l: '2', t: '0', pct: '.667', pf: '147', pa: '117', diff: '+30',
      div: '2-0', conf: '3-1', strk: 'W3',
    });
    assert.deepEqual(recordText(out.get('MIA')!), {
      record: '1-5', w: '1', l: '5', t: '0', pct: '.167', pf: '137', pa: '127', diff: '+10',
      div: '1-1', conf: '2-2', strk: 'L4',
    });
  });

  test('across conferences only the overall record moves', () => {
    const out = applyFinals(base, [{ away: 'DAL', home: 'BUF', awayScore: 20, homeScore: 20 }]);
    const dal = recordText(out.get('DAL')!);
    assert.equal(dal.record, '3-2-1');
    assert.equal(dal.div, '1-0');
    assert.equal(dal.conf, '2-1');
    assert.equal(dal.strk, 'T1');
    assert.equal(dal.pct, '.583');
  });

  test('a team with two finals counts both, and the base is left alone', () => {
    const out = applyFinals(base, [
      { away: 'MIA', home: 'BUF', awayScore: 17, homeScore: 27 },
      { away: 'BUF', home: 'DAL', awayScore: 10, homeScore: 13 },
    ]);
    assert.equal(recordText(out.get('BUF')!).record, '4-3');
    assert.equal(out.get('BUF')!.streak, 'L1');
    assert.equal(base.BUF.wins, 3);
  });

  test('a team the page has no standing for is skipped', () => {
    assert.equal(applyFinals(base, [{ away: 'NYJ', home: 'BUF', awayScore: 3, homeScore: 6 }]).size, 0);
  });
});

describe('helpers', () => {
  test('streaks extend or restart', () => {
    assert.equal(nextStreak('W3', 'W'), 'W4');
    assert.equal(nextStreak('W3', 'L'), 'L1');
    assert.equal(nextStreak(null, 'T'), 'T1');
  });

  test('pct counts ties as half and is 0 before a game', () => {
    assert.equal(winPct(0, 0, 0), 0);
    assert.equal(winPct(1, 0, 0), 1);
    assert.equal(winPct(2, 1, 1), 0.625);
  });

  test('pct rounds an exact half to even, as Python round() does', () => {
    assert.equal(winPct(4, 3, 1), 0.562); // 0.5625
    assert.equal(winPct(6, 1, 1), 0.812); // 0.8125
    assert.equal(winPct(2, 5, 1), 0.312); // 0.3125
    assert.equal(winPct(1, 6, 1), 0.188); // 0.1875
    assert.equal(winPct(2, 1, 0), 0.667);
    assert.equal(winPct(1, 2, 0), 0.333);
  });
});
