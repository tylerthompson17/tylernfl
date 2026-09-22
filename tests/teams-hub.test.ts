import assert from 'node:assert/strict';
import { test } from 'node:test';

import { lineText, nextGame, opponentText, ordinal, resultText, teamGames } from '../src/lib/teams/hub.ts';
import type { ScheduleGame } from '../src/data/types.ts';

function game(week: number, away: string, home: string, awayScore: number | null = null, homeScore: number | null = null, extra: Partial<ScheduleGame> = {}): ScheduleGame {
  return {
    id: `2026_${week}_${away}_${home}`, week, type: 'REG', kickoff: null, away, home, awayScore, homeScore,
    overtime: false, divisional: false, neutral: false, spreadLine: null, awayMoneyline: null, homeMoneyline: null,
    ...extra,
  };
}

const season = [
  game(1, 'BUF', 'HOU', 36, 31),
  game(2, 'DET', 'BUF', 31, 41),
  game(3, 'BUF', 'MIA', 20, 20, { overtime: true }),
  game(4, 'NYJ', 'BUF', 27, 24),
  game(5, 'BUF', 'NE', null, null, { spreadLine: -3.5 }),
  game(5, 'KC', 'DEN'),
];

test("a team's games from its side, with the running record", () => {
  const games = teamGames(season, 'BUF');
  assert.equal(games.length, 5);
  assert.deepEqual(games.map((g) => [opponentText(g), resultText(g), g.recordAfter]), [
    ['at HOU', 'W 36-31', '1-0'],
    ['vs DET', 'W 41-31', '2-0'],
    ['at MIA', 'T 20-20 (OT)', '2-0-1'],
    ['vs NYJ', 'L 24-27', '2-1-1'],
    ['at NE', null, null],
  ]);
});

test('the next game is the first one not played', () => {
  assert.equal(nextGame(teamGames(season, 'BUF'))?.opponent, 'NE');
  assert.equal(nextGame(teamGames(season.slice(0, 2), 'BUF')), null);
});

test('lines name the favorite', () => {
  assert.equal(lineText(game(5, 'BUF', 'NE', null, null, { spreadLine: -3.5 })), 'BUF by 3.5');
  assert.equal(lineText(game(3, 'SEA', 'WAS', null, null, { spreadLine: 7 })), 'WAS by 7');
  assert.equal(lineText(game(3, 'SEA', 'WAS', null, null, { spreadLine: 0 })), "Pick'em");
  assert.equal(lineText(game(3, 'SEA', 'WAS')), null);
});

test('neutral sites read vs for both teams', () => {
  const sb = teamGames([game(22, 'KC', 'PHI', null, null, { type: 'SB', neutral: true })], 'KC')[0]!;
  assert.equal(opponentText(sb), 'vs PHI');
});

test('playoff games do not change the regular season record', () => {
  const games = teamGames([game(18, 'BUF', 'NYJ', 30, 10), game(19, 'PIT', 'BUF', 10, 31, { type: 'WC' })], 'BUF');
  assert.deepEqual(games.map((g) => g.recordAfter), ['1-0', null]);
  assert.equal(resultText(games[1]!), 'W 31-10');
});

test('places', () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd']);
});
