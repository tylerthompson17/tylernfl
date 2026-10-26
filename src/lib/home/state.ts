/**
 * Which of four moments the home page is built in (src/pages/index.astro
 * lays out each one). The daily and game day jobs rebuild the site, so the
 * build's moment is good enough until the next one.
 *
 * - gameday: a game of the ticker's season kicks off on today's Eastern date.
 * - recap: every game on the ticker is final (Monday night to Tuesday).
 * - preview: the ticker has moved on to a week with games still to play.
 * - offseason: the ticker has no games.
 */
import type { ScheduleGame, TickerGame } from '../../data/types';

export type HomeState = 'gameday' | 'recap' | 'preview' | 'offseason';

/** "2026-09-20": the Eastern calendar date of an instant. */
export const easternDate = (d: Date): string => d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

export function homeState(now: Date, schedule: Pick<ScheduleGame, 'kickoff'>[], ticker: Pick<TickerGame, 'state'>[]): HomeState {
  if (ticker.length === 0) return 'offseason';
  const today = easternDate(now);
  if (schedule.some((g) => g.kickoff !== null && easternDate(new Date(g.kickoff)) === today)) return 'gameday';
  return ticker.some((g) => g.state !== 'final') ? 'preview' : 'recap';
}

/**
 * The week the home page calls "the week": the latest one every game of
 * which is final and measured (completeWeeks in src/lib/week/recap.ts, the
 * week /week recaps). Results, questionable calls and notable performances
 * all name this week, so they cannot disagree.
 */
export const homeWeek = (complete: number[]): number | null => complete.at(-1) ?? null;

/**
 * The week whose questionable calls the home page shows: the home week if
 * it has graded decisions, else the latest earlier week that does.
 */
export function callsWeek(homeWeekNumber: number | null, decisionWeeks: number[]): number | null {
  if (homeWeekNumber === null) return null;
  const weeks = decisionWeeks.filter((w) => w <= homeWeekNumber);
  return weeks.length === 0 ? null : Math.max(...weeks);
}
