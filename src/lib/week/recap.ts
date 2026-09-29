/**
 * The week recap: a week's games ranked by excitement, from schedule.json
 * and game_excitement.json. The order is the pipeline's `score`
 * (GAME_SCORE in pipelines/excitement.py, the same function that picks
 * the day's auto chart); this module only sorts and ranks.
 */
import type { GameExcitement, ScheduleGame } from '../../data/types';

export interface RecapGame {
  /** Equal scores share a rank */
  rank: number;
  game: ScheduleGame;
  excitement: GameExcitement;
}

/**
 * Weeks every game of which has excitement numbers, oldest first. A week
 * with a game still to play, or one nflverse has no play-by-play for yet
 * (a Monday night game until the next morning), is not complete, so a
 * recap never ranks half a week.
 */
export function completeWeeks(schedule: ScheduleGame[], excitement: GameExcitement[]): number[] {
  const measured = new Set(excitement.map((e) => e.id));
  const weeks = [...new Set(schedule.map((g) => g.week))].sort((a, b) => a - b);
  return weeks.filter((week) => schedule.filter((g) => g.week === week).every((g) => measured.has(g.id)));
}

/** One week's games, highest score first; equal scores in kickoff order. */
export function rankWeek(schedule: ScheduleGame[], excitement: GameExcitement[], week: number): RecapGame[] {
  const byId = new Map(excitement.map((e) => [e.id, e]));
  const games = schedule
    .filter((g) => g.week === week && byId.has(g.id))
    .map((game) => ({ game, excitement: byId.get(game.id)! }))
    .sort(
      (a, b) =>
        b.excitement.score - a.excitement.score || (a.game.kickoff ?? '').localeCompare(b.game.kickoff ?? '')
    );
  return games.map((g) => ({
    ...g,
    rank: 1 + games.filter((o) => o.excitement.score > g.excitement.score).length,
  }));
}
