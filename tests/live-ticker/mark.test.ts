import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import { lineScores, parseEvent } from '../../src/lib/live-ticker/espn.ts';
import { completedPeriods, liveMark, type MarkInput } from '../../src/lib/live-ticker/mark.ts';

/**
 * A recorded DET at BUF event (2026-09-17), optionally with the live score
 * changed, so each rule can be seen on a real response. The line scores
 * are left as recorded: they are what the Comeback rule reads.
 */
function event(name: string, scores?: { away: number; home: number }): unknown {
  // Each capture wraps its one event as a scoreboard response does.
  const data = JSON.parse(readFileSync(new URL(`../fixtures/espn/${name}`, import.meta.url), 'utf8')).events[0];
  if (scores) {
    for (const c of data.competitions[0].competitors) c.score = String(scores[c.homeAway as 'away' | 'home']);
  }
  return data;
}

const markOf = (name: string, scores?: { away: number; home: number }) => parseEvent(event(name, scores))?.[1].mark;

describe('the recorded DET at BUF game', () => {
  test('never qualified: BUF led by 14 to 17 from the first quarter on', () => {
    for (const name of [
      'event-401872932-in_progress-q2.json',
      'event-401872932-halftime-q2.json',
      'event-401872932-in_progress-q3.json',
      'event-401872932-in_progress-q4.json',
      'event-401872932-final-q4.json',
    ]) {
      assert.equal(markOf(name), null, name);
    }
  });

  test('line scores are read per quarter', () => {
    const data = event('event-401872932-in_progress-q4.json') as { competitions: { competitors: object[] }[] };
    const [home, away] = data.competitions[0]!.competitors as Record<string, unknown>[];
    assert.deepEqual(lineScores(home!), [14, 13, 7, 0]);
    assert.deepEqual(lineScores(away!), [0, 10, 7, 0]);
  });
});

describe('Comeback, on the recorded game with the score changed', () => {
  test('DET, down 14 after the first quarter, within 7 in the second', () => {
    assert.equal(markOf('event-401872932-in_progress-q2.json', { away: 14, home: 21 }), 'Comeback');
  });

  test('down 17 at the half, within 7 at the start of the third', () => {
    assert.equal(markOf('event-401872932-in_progress-q3.json', { away: 20, home: 27 }), 'Comeback');
  });

  test('down 17 after three, now leading in the fourth; ahead of Close game', () => {
    assert.equal(markOf('event-401872932-in_progress-q4.json', { away: 38, home: 34 }), 'Comeback');
  });

  test('still down 9 is not back within one score', () => {
    assert.equal(markOf('event-401872932-in_progress-q4.json', { away: 25, home: 34 }), null);
  });

  test('a finished game is never marked, however it went', () => {
    assert.equal(markOf('event-401872932-final-q4.json', { away: 38, home: 41 }), null);
  });
});

const game = (over: Partial<MarkInput>): MarkInput => ({
  period: 2,
  status: 'STATUS_IN_PROGRESS',
  awayScore: 0,
  homeScore: 0,
  awayLines: [],
  homeLines: [],
  ...over,
});

describe('which quarters have ended', () => {
  test('in progress, the ones before; at the half or a quarter break, the current one too', () => {
    assert.equal(completedPeriods(2, 'STATUS_IN_PROGRESS'), 1);
    assert.equal(completedPeriods(2, 'STATUS_HALFTIME'), 2);
    assert.equal(completedPeriods(3, 'STATUS_END_PERIOD'), 3);
    assert.equal(completedPeriods(1, 'STATUS_IN_PROGRESS'), 0);
  });

  test('a deficit inside the quarter being played does not count yet', () => {
    // 0 to 21 during the second quarter, but only 0 to 7 when the first ended.
    const midQuarter = game({ awayScore: 14, homeScore: 21, awayLines: [0, 14], homeLines: [7, 14] });
    assert.equal(liveMark(midQuarter), null);
    // Once that quarter is over it does: down 21 at the half, within 4 in the third.
    const later = game({ period: 3, awayScore: 17, homeScore: 21, awayLines: [0, 0, 17], homeLines: [7, 14, 0] });
    assert.equal(liveMark(later), 'Comeback');
  });

  test('without line scores there is no comeback to see', () => {
    assert.equal(liveMark(game({ period: 3, awayScore: 17, homeScore: 21 })), null);
    assert.equal(liveMark(game({ period: 4, awayScore: 17, homeScore: 21 })), 'Close game');
  });

  test('the home team can come back too', () => {
    const home = game({ period: 3, awayScore: 21, homeScore: 20, awayLines: [14, 7, 0], homeLines: [0, 7, 13] });
    assert.equal(liveMark(home), 'Comeback');
  });
});

describe('Close game and Shootout', () => {
  const even = { awayLines: [7, 7, 7], homeLines: [3, 10, 7] };

  test('within 8 in the fourth quarter or overtime', () => {
    assert.equal(liveMark(game({ period: 4, awayScore: 24, homeScore: 20, ...even })), 'Close game');
    assert.equal(liveMark(game({ period: 5, awayScore: 23, homeScore: 23, ...even })), 'Close game');
    assert.equal(liveMark(game({ period: 4, awayScore: 29, homeScore: 20, ...even })), null);
    assert.equal(liveMark(game({ period: 3, awayScore: 24, homeScore: 20, ...even })), null);
  });

  test('50 or more points within 8, in any quarter', () => {
    assert.equal(liveMark(game({ period: 3, awayScore: 28, homeScore: 24 })), 'Shootout');
    assert.equal(liveMark(game({ period: 3, awayScore: 30, homeScore: 20 })), null);
    assert.equal(liveMark(game({ period: 3, awayScore: 28, homeScore: 21 })), null);
  });

  test('in the fourth quarter a close shootout reads as a close game', () => {
    assert.equal(liveMark(game({ period: 4, awayScore: 31, homeScore: 28 })), 'Close game');
  });
});
