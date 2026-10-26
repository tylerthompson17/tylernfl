import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { DecisionsData, FourthDownDecision, TryDecision } from '../src/data/types.ts';
import {
  callWords,
  chartSlug,
  clockLine,
  gameWords,
  introLines,
  optionWords,
  situationWords,
  spotWords,
  worstDecisions,
} from '../src/lib/decisions/view.ts';

function fourth(over: Partial<FourthDownDecision> = {}, situation: Partial<FourthDownDecision['situation']> = {}): FourthDownDecision {
  return {
    gameId: '2026_05_SEA_SF', playId: 100, week: 5, coach: 'Mike Macdonald', description: 'punts',
    call: 'go', wpCost: 0.03, graded: true, skip: null, margin: 0.03,
    situation: {
      season: 2026, posteam: 'SEA', defteam: 'SF', home: 'SF', yardline100: 34, distance: 2, overtime: false,
      secondsRemaining: 1500, halfSecondsRemaining: 1500, scoreDiff: 3, timeoutsOffense: 3, timeoutsDefense: 3,
      homeOpeningKickoff: true, roof: 'outdoors', temp: null, spreadLine: 1.5, totalLine: 44.5, ...situation,
    },
    teamCall: 'punt', fake: false, delayOfGame: null, timeoutBefore: null, presnapPenalties: [],
    wpGo: 0.52, wpPunt: 0.49, wpFieldGoal: null, conversionProb: 0.6, fgMakeProb: null, kickDistance: 52,
    ...over,
  };
}

function attempt(over: Partial<TryDecision> = {}): TryDecision {
  return {
    gameId: '2026_04_BUF_KC', playId: 200, week: 4, coach: 'Andy Reid', description: 'extra point',
    call: 'go for 2', wpCost: 0.021, graded: true, skip: null, margin: 0.021,
    situation: {
      season: 2026, posteam: 'KC', defteam: 'BUF', home: 'KC', overtime: false, secondsRemaining: 300,
      halfSecondsRemaining: 300, scoreDiff: -2, timeoutsOffense: 2, timeoutsDefense: 3, homeOpeningKickoff: false,
      roof: 'outdoors', spreadLine: -1, totalLine: 47,
    },
    teamCall: 'kick', wpKick: 0.30, wpGoForTwo: 0.321, patMakeProb: 0.94, twoPointConvProb: 0.48,
    ...over,
  };
}

test('clock, spot and situation in words', () => {
  assert.equal(clockLine(3600, 1800), 'Q1 15:00');
  assert.equal(clockLine(1920, 120), 'Q2 2:00');
  assert.equal(clockLine(1500, 1500), 'Q3 10:00');
  assert.equal(clockLine(65, 65), 'Q4 1:05');
  assert.equal(spotWords(54, 'CLE'), 'own 46');
  assert.equal(spotWords(34, 'SF'), 'SF 34');
  assert.equal(spotWords(50, 'SF'), 'midfield');
  assert.equal(situationWords(fourth()), '4th and 2 at SF 34, Q3 10:00, up 3');
  assert.equal(situationWords(fourth({}, { yardline100: 2, distance: 2, scoreDiff: 0 })), '4th and goal at SF 2, Q3 10:00, tied');
  assert.equal(situationWords(attempt()), 'After a TD, down 2, Q4 5:00');
});

test('calls, options and the game chart', () => {
  assert.equal(callWords('go'), 'Go for it');
  assert.equal(callWords('kick'), 'Extra point');
  assert.equal(optionWords(fourth()), 'Go 52.0%, Punt 49.0%');
  assert.equal(optionWords(attempt()), 'XP 30.0%, 2 pt 32.1%');
  assert.equal(chartSlug(fourth(), 2026), 'auto-2026-week-5-sea-at-sf-win-probability');
  assert.equal(gameWords(attempt()), 'BUF at KC');
});

function data(fourthDowns: FourthDownDecision[], tries: TryDecision[] = []): DecisionsData {
  return {
    season: 2026, updated: '2026-10-23T01:00:00Z', modelVersion: 'nfl4th-ecb7293', label: "nfl4th's recommendation",
    threshold: 0.02, games: 2, counts: {}, experimentalCounts: {}, coaches: [], fourthDowns, tries,
    summary: {
      fourthDowns: 1193, nfl4thGoShare: 0.41576, coachGoShare: 0.16262, mistakes: 110, kicksModelWouldGo: 103,
      kicksModelWouldGoShare: 0.93636, closeMargin: 0.05, closeCalls: 96, closeCallShare: 0.87273,
    },
  };
}

test('worst decisions: both kinds, costliest first, equal shown costs share a rank', () => {
  const d = data(
    [fourth({ playId: 1, wpCost: 0.05 }), fourth({ playId: 2, wpCost: 0.0504 }), fourth({ playId: 3, wpCost: 0.01, graded: false })],
    [attempt({ wpCost: 0.07 })],
  );
  const { rows, total } = worstDecisions(d, 10);
  assert.equal(total, 3);
  assert.deepEqual(rows.map((r) => [r.rank, r.decision.playId]), [[1, 200], [2, 1], [2, 2]]);
  assert.equal(worstDecisions(d, 1).rows.length, 1);
});

test('the intro quotes the pipeline numbers', () => {
  const lines = introLines(data([]).summary)!;
  assert.match(lines[0], /recommends going on 41\.6% of this season's 1,193 evaluated 4th downs; coaches went on 16\.3%/);
  assert.match(lines[1], /103 of 110 \(93\.6%\)/);
  assert.match(lines[1], /87\.3% had nfl4th's top two options within 5 points/);
  assert.equal(introLines({ ...data([]).summary, fourthDowns: 0 }), null);
});

test("a team's calls by game: questionable ones and its three biggest, newest game first", async () => {
  const { teamGameCalls } = await import('../src/lib/decisions/team.ts');
  const d = (playId: number, week: number, margin: number, graded: boolean, posteam = 'SEA') =>
    fourth({ playId, week, gameId: `2026_0${week}_SEA_SF`, margin, graded, wpCost: graded ? 0.03 : 0.0 }, { posteam });
  const games = teamGameCalls(
    data([d(1, 5, 0.01, false), d(2, 5, 0.2, false), d(3, 5, 0.1, false), d(4, 5, 0.06, true), d(5, 5, 0.02, false), d(6, 6, 0.01, true), d(7, 6, 0.3, false, 'SF')]),
    'SEA',
  );
  assert.deepEqual(games.map((g) => g.week), [6, 5]);
  const week5 = games[1];
  assert.deepEqual(week5.rows.map((r) => [r.decision.playId, r.questionable, r.clear, r.big]), [
    [2, false, false, true],
    [3, false, false, true],
    [4, true, true, true],
  ]);
  assert.equal(week5.decisions, 5);
  assert.deepEqual(games[0].rows.map((r) => [r.decision.playId, r.questionable, r.clear]), [[6, true, false]]);
});
