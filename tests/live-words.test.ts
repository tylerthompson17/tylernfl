import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { LiveGrade } from '../src/lib/live-fourth/grade.ts';
import { pendingLine, playSummary, verdictLine } from '../src/lib/live-fourth/words.ts';

test('plain summaries of real 4th down plays (NE at CHI, PIT at NO)', () => {
  const cases: [string, string, number, string | null, string][] = [
    ['Punt', 'M.Wishnowsky punts 46 yards to CHI 21, Center-J.Ashby, fair catch by K.Raymond.', 4, 'punt', 'Punted 46 yards'],
    ['Field Goal Good', 'C.Santos 43 yard field goal is GOOD, Center-S.Daly, Holder-T.Taylor.', 7, 'field goal', 'Made a 43-yard field goal'],
    ['Field Goal Missed', 'C.Santos 53 yard field goal is No Good, Hit Right Upright, Center-S.Daly.', 11, 'field goal', 'Missed a 53-yard field goal'],
    ['Pass Reception', '(Shotgun) C.Williams pass short middle to C.Loveland to NE 34 for 9 yards (C.Woods).', 2, 'go', 'Converted with a 9-yard pass'],
    ['Rush', 'D.Swift left tackle pushed ob at NE 15 for 5 yards (C.Woodson).', 1, 'go', 'Converted with a 5-yard run'],
    ['Sack', '(Shotgun) D.Maye sacked at CHI 46 for -1 yards (K.Gordon).', 5, 'go', 'Stopped: sacked for a loss of 1 yard'],
    ['Passing Touchdown', '(Shotgun) T.Shough pass short left to D.Vele for 1 yard, TOUCHDOWN. D.Carlson extra point is GOOD.', 1, 'go', 'Touchdown on a 1-yard pass'],
    ['Pass Incompletion', '(Shotgun) J.Allen pass incomplete short right to D.Moore.', 3, 'go', 'Stopped: incomplete pass'],
    ['Rush', 'J.Cook up the middle to KC 47 for 1 yard.', 2, 'go', 'Stopped: a 1-yard run, short of the line'],
    ['Rush', 'J.Cook up the middle for no gain.', 1, 'go', 'Stopped: no gain on a run, short of the line'],
    ['Pass Interception Return', 'C.Williams pass deep left intended for R.Odunze INTERCEPTED by C.Gonzalez.', 6, 'go', 'Stopped: intercepted'],
    ['Pass Reception', '(Punt formation) B.Pinion pass short right to T.Hill for 12 yards.', 4, 'go', 'Fake: Converted with a 12-yard pass'],
  ];
  for (const [type, text, distance, call, expected] of cases) {
    assert.equal(playSummary(type, text, distance, call as never, /formation/.test(text)), expected, text);
  }
});

const graded = (call: 'go' | 'punt' | 'field goal', margin: number, wpLost: number | null): LiveGrade => ({
  kind: 'graded', call, wpGo: 0.5, wpFieldGoal: null, wpPunt: 0.5, wpLost, questionable: false, clear: false, decided: false, margin,
});

test('verdicts against nfl4th', () => {
  assert.equal(verdictLine(graded('punt', 0.047, 0), 'punt'), 'Agreed with nfl4th: Punt (by 4.7 points)');
  assert.equal(verdictLine(graded('go', 0.031, 0.031), 'punt'), 'Went against nfl4th: it said Go for it (by 3.1 points)');
  assert.equal(verdictLine(graded('go', 0.012, 0.012), 'punt'), 'A close call (nfl4th leaned Go for it, by 1.2 points)');
  assert.equal(verdictLine({ kind: 'unsupported', message: "Not graded: nfl4th doesn't compute overtime." }, 'go'), "Not graded: nfl4th doesn't compute overtime.");
  assert.equal(pendingLine(graded('go', 0.031, null)), 'nfl4th says: Go for it, by 3.1 points. Waiting for the snap.');
});

test('a or an before a yardage', async () => {
  const { aYards } = await import('../src/lib/live-fourth/words.ts');
  assert.deepEqual([1, 8, 9, 11, 18, 28, 80, 88].map(aYards), ['a 1-yard', 'an 8-yard', 'a 9-yard', 'an 11-yard', 'an 18-yard', 'a 28-yard', 'an 80-yard', 'an 88-yard']);
  assert.equal(playSummary('Pass Reception', 'pass short left to C.Olave for 11 yards', 2, 'go', false), 'Converted with an 11-yard pass');
  assert.equal(playSummary('Field Goal Good', '18 yard field goal is GOOD', 1, 'field goal', false), 'Made an 18-yard field goal');
});
