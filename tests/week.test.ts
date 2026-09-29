import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { GameExcitement, ScheduleGame } from '../src/data/types.ts';
import { completeWeeks, rankWeek } from '../src/lib/week/recap.ts';

function game(week: number, away: string, home: string, kickoff: string): ScheduleGame {
  return {
    id: `2026_${String(week).padStart(2, '0')}_${away}_${home}`,
    week,
    type: 'REG',
    kickoff,
    away,
    home,
    awayScore: 20,
    homeScore: 17,
    overtime: false,
    divisional: false,
    neutral: false,
    spreadLine: null,
    awayMoneyline: null,
    homeMoneyline: null,
  };
}

function measured(g: ScheduleGame, score: number): GameExcitement {
  return { id: g.id, week: g.week, away: g.away, home: g.home, index: score, winnerLowWp: 0.4, score, label: null };
}

const SUN = '2026-09-20T17:00:00Z';
const SUN_LATE = '2026-09-20T20:25:00Z';
const MON = '2026-09-22T00:15:00Z';

test('a week is complete only once every game has numbers', () => {
  const schedule = [game(1, 'A', 'B', SUN), game(1, 'C', 'D', MON), game(2, 'E', 'F', SUN), game(2, 'G', 'H', MON)];
  // Week 2's Monday game has no play-by-play yet.
  const excitement = [measured(schedule[0], 3), measured(schedule[1], 4), measured(schedule[2], 5)];
  assert.deepEqual(completeWeeks(schedule, excitement), [1]);
  assert.deepEqual(completeWeeks(schedule, []), []);
});

test('highest score first, equal scores share a rank in kickoff order', () => {
  const schedule = [game(3, 'A', 'B', SUN_LATE), game(3, 'C', 'D', SUN), game(3, 'E', 'F', MON), game(4, 'G', 'H', SUN)];
  const excitement = [measured(schedule[0], 5.1), measured(schedule[1], 5.1), measured(schedule[2], 7.3), measured(schedule[3], 9)];
  const ranked = rankWeek(schedule, excitement, 3);
  assert.deepEqual(
    ranked.map((r) => [r.rank, r.game.away]),
    [[1, 'E'], [2, 'C'], [2, 'A']]
  );
});
