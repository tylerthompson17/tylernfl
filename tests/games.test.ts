import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { FourthDownDecision, GameTeamBox, TryDecision } from '../src/data/types.ts';
import {
  decisionItem,
  gamePath,
  markLabel,
  periodLabels,
  playText,
  quarterClock,
  spreadResult,
  spreadText,
  swingOf,
  teamBoxRows,
  totalResult,
  trySummary,
} from '../src/lib/games/view.ts';

const game = { season: 2026, week: 1, away: 'ARI', home: 'LAR', awayScore: 26, homeScore: 14, spreadLine: 8.5, totalLine: 47.5 };

test('game path: season, week, lower case teams', () => {
  assert.equal(gamePath(game), 'games/2026/1/ari-at-lar');
});

test('spread as a sportsbook writes it, and who covered', () => {
  assert.equal(spreadText(game), 'LAR -8.5');
  assert.equal(spreadText({ ...game, spreadLine: -3 }), 'ARI -3');
  assert.equal(spreadText({ ...game, spreadLine: 0 }), "Pick'em");
  assert.equal(spreadText({ ...game, spreadLine: null }), null);
  // ARI won by 12 as an 8.5 point underdog.
  assert.equal(spreadResult(game), 'ARI covered by 20.5.');
  assert.equal(spreadResult({ ...game, awayScore: 10, homeScore: 13, spreadLine: 3 }), 'A push.');
  assert.equal(spreadResult({ ...game, awayScore: 10, homeScore: 20, spreadLine: 3 }), 'LAR covered by 7.');
});

test('total: over, under or a push', () => {
  assert.equal(totalResult(game), '40 points: under by 7.5.');
  assert.equal(totalResult({ ...game, totalLine: 40 }), '40 points: a push.');
  assert.equal(totalResult({ ...game, totalLine: 38.5 }), '40 points: over by 1.5.');
  assert.equal(totalResult({ ...game, totalLine: null }), null);
});

test('periods: quarters, then overtime', () => {
  assert.deepEqual(periodLabels(4), ['1', '2', '3', '4']);
  assert.deepEqual(periodLabels(6), ['1', '2', '3', '4', 'OT', 'OT2']);
});

test('plays: clock and nflverse text without its leading clock', () => {
  assert.equal(quarterClock(2, '02:00'), 'Q2 2:00');
  assert.equal(quarterClock(5, '06:10'), 'OT 6:10');
  assert.equal(playText('(13:37) (Shotgun) 10-J.Herbert sacked at ARI 13 for -10 yards.'), '(Shotgun) 10-J.Herbert sacked at ARI 13 for -10 yards.');
  assert.equal(playText('(:34) 8-R.Sanchez punts 41 yards.'), '8-R.Sanchez punts 41 yards.');
});

test('a swing is told from the side it helped', () => {
  const p = { playId: 1, quarter: 2, clock: '13:37', offense: 'LAR', description: '', homeWpBefore: 0.6768, homeWpAfter: 0.5502 };
  assert.deepEqual(swingOf(p, game), { team: 'ARI', points: '12.7', wp: '32.3% to 45.0%' });
  assert.deepEqual(swingOf({ ...p, homeWpBefore: 0.3, homeWpAfter: 0.4 }, game), { team: 'LAR', points: '10.0', wp: '30.0% to 40.0%' });
});

const box: GameTeamBox = {
  plays: 72, yards: 393, passYards: 277, rushYards: 116, firstDowns: 23, epaPerPlay: 0.139, successRate: 0.486,
  thirdDowns: [6, 14], fourthDowns: [0, 0], redZone: [2, 5], turnovers: 0, timeOfPossession: 2251,
};

test('team box rows', () => {
  const rows = teamBoxRows(box, { ...box, epaPerPlay: -0.167, timeOfPossession: 1349 });
  const at = (label: string) => rows.find((r) => r.label === label)!;
  assert.equal(at('Yards per play').away, '5.5');
  assert.equal(at('EPA per play').away, '+0.139');
  assert.equal(at('EPA per play').home, '−0.167');
  assert.equal(at('3rd down').away, '6 of 14 (42.9%)');
  assert.equal(at('4th down').away, '0 of 0');
  assert.equal(at('Time of possession').away, '37:31');
  assert.equal(at('Time of possession').home, '22:29');
});

const fourth = (over: Partial<FourthDownDecision>): FourthDownDecision => ({
  gameId: '2026_01_ARI_LA',
  coach: 'Jonathan Gannon',
  playId: 3127,
  week: 1,
  description: '(14:04) 16-B.Gillikin punts 60 yards to LA 0, Center-59-C.Kreiter, Touchback.',
  situation: {
    season: 2026, posteam: 'ARI', defteam: 'LAR', home: 'LAR', overtime: false, secondsRemaining: 844,
    halfSecondsRemaining: 844, scoreDiff: 2, timeoutsOffense: 3, timeoutsDefense: 3, homeOpeningKickoff: false,
    roof: 'dome', spreadLine: 8.5, totalLine: 47.5, yardline100: 60, distance: 1, temp: null,
  },
  teamCall: 'punt',
  fake: false,
  delayOfGame: null,
  timeoutBefore: null,
  presnapPenalties: [],
  wpGo: 0.516,
  wpPunt: 0.452,
  wpFieldGoal: null,
  conversionProb: 0.7,
  fgMakeProb: null,
  kickDistance: null,
  call: 'go',
  margin: 0.063,
  wpCost: 0.063,
  graded: true,
  skip: null,
  ...over,
} as FourthDownDecision);

test('a 4th down in the live items wording', () => {
  const item = decisionItem(fourth({}), 0.05);
  assert.equal(item.anchor, 'play-3127');
  assert.equal(item.when, 'Q4 14:04');
  assert.equal(item.down, 'ARI 4th and 1 at own 40, up 2');
  assert.equal(item.play, 'Punted 60 yards');
  assert.equal(item.verdict, 'Went against nfl4th: it said Go for it (by 6.3 points)');
  assert.equal(item.wp, 'Go 51.6%; Punt 45.2%');
  assert.equal(item.questionable, true);
  assert.equal(item.clear, true);
  assert.equal(markLabel(item), '4th down, Q4 14:04: ARI 4th and 1 at own 40, up 2. Punted 60 yards. Questionable call.');
});

test('agreed, close, decided and unsupported 4th downs', () => {
  const agreed = decisionItem(fourth({ call: 'punt', wpGo: 0.4, margin: 0.052, wpCost: 0, graded: false }), 0.05);
  assert.equal(agreed.verdict, 'Agreed with nfl4th: Punt (by 5.2 points)');
  assert.equal(agreed.questionable, false);
  const close = decisionItem(fourth({ margin: 0.012, wpCost: 0.012, graded: false }), 0.05);
  assert.equal(close.verdict, 'A close call (nfl4th leaned Go for it, by 1.2 points)');
  const decided = decisionItem(fourth({ skip: 'decided', graded: false }), 0.05);
  assert.match(decided.verdict, /^Went against nfl4th: it said Go for it \(by 6\.3 points\)\. The game was already decided/);
  const overtime = decisionItem(fourth({ skip: 'overtime', call: null, margin: undefined, wpCost: null, graded: false }), 0.05);
  assert.equal(overtime.verdict, "Not graded: nfl4th doesn't compute overtime.");
  assert.equal(overtime.wp, null);
});

test('a try in the same wording', () => {
  const t: TryDecision = {
    gameId: '2026_01_ARI_LA',
    coach: 'Jonathan Gannon',
    playId: 319,
    week: 1,
    description: '38-C.Ryland extra point is GOOD, Center-59-C.Kreiter, Holder-12-B.Gillikin.',
    situation: {
      season: 2026, posteam: 'ARI', defteam: 'LAR', home: 'LAR', overtime: false, secondsRemaining: 3229,
      halfSecondsRemaining: 1429, scoreDiff: 6, timeoutsOffense: 2, timeoutsDefense: 3, homeOpeningKickoff: false,
      roof: 'dome', spreadLine: 8.5, totalLine: 47.5,
    },
    teamCall: 'kick',
    wpKick: 0.35462,
    wpGoForTwo: 0.3693,
    patMakeProb: 0.96,
    twoPointConvProb: 0.38,
    call: 'go for 2',
    margin: 0.01468,
    wpCost: 0.01468,
    graded: false,
    skip: null,
  } as TryDecision;
  const item = decisionItem(t, 0.05);
  assert.equal(item.when, 'Q1 8:49');
  assert.equal(item.down, 'ARI try after a touchdown, up 6');
  assert.equal(item.play, 'Extra point good');
  assert.equal(item.verdict, 'A close call (nfl4th leaned Go for 2, by 1.5 points)');
  assert.equal(item.wp, 'Extra point 35.5%; Go for 2 36.9%');
  assert.equal(item.fourthDown, false);
});

test('try summaries from nflverse text', () => {
  assert.equal(trySummary('kick', '38-C.Ryland extra point is No Good, Wide Right'), 'Extra point missed');
  assert.equal(trySummary('kick', 'extra point is Blocked'), 'Extra point blocked');
  assert.equal(
    trySummary('go for 2', 'TWO-POINT CONVERSION ATTEMPT. 11-C.Wentz pass to 18-J.Jefferson is complete. ATTEMPT SUCCEEDS.'),
    'Converted the two-point try with a pass',
  );
  assert.equal(trySummary('go for 2', 'TWO-POINT CONVERSION ATTEMPT. 2-J.Love rushes up the middle. ATTEMPT FAILS.'), 'Two-point try failed on a run');
});
