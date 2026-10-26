/**
 * Which of four moments the home page is built in (src/pages/index.astro
 * lays out each one). The daily and game day jobs rebuild the site, the game
 * day job also when a game window opens (pipelines/gameday.py), so the
 * build's moment holds until the next.
 *
 * - live: a game is in its window, from LIVE_LEAD before kickoff until it is
 *   final (or STALE_HOURS after kickoff, when nflverse has given up on it).
 * - recap: no game on, and at least RECAP_GAMES games went final with
 *   kickoffs in the last RECAP_HOURS (the morning after a Sunday or Monday
 *   night, not the day after one Thursday game).
 * - preview: no game on and nothing much just played (midweek, a game day
 *   morning).
 * - offseason: the ticker has no games.
 */
import type { ScheduleGame, TickerGame } from '../../data/types';

export type HomeState = 'live' | 'recap' | 'preview' | 'offseason';

/** Matches LIVE_LEAD in pipelines/gameday.py, which rebuilds the site then. */
export const LIVE_LEAD_MINUTES = 15;
const STALE_HOURS = 8;
export const RECAP_HOURS = 48;
export const RECAP_GAMES = 3;

const HOUR = 3_600_000;

type Game = Pick<ScheduleGame, 'week' | 'kickoff' | 'awayScore' | 'homeScore'>;

const isFinal = (g: Game): boolean => g.awayScore !== null && g.homeScore !== null;

export function homeState(now: Date, schedule: Game[], ticker: Pick<TickerGame, 'state'>[]): HomeState {
  if (ticker.length === 0) return 'offseason';
  const t = now.getTime();
  const at = (g: Game) => (g.kickoff === null ? null : new Date(g.kickoff).getTime());
  const live = schedule.some((g) => {
    const k = at(g);
    return k !== null && !isFinal(g) && k - LIVE_LEAD_MINUTES * 60_000 <= t && t <= k + STALE_HOURS * HOUR;
  });
  if (live) return 'live';
  const recent = schedule.filter((g) => {
    const k = at(g);
    return k !== null && isFinal(g) && t - RECAP_HOURS * HOUR <= k && k <= t;
  });
  return recent.length >= RECAP_GAMES ? 'recap' : 'preview';
}

/** Whether any game kicks off on `now`'s Eastern calendar date. */
export function kickoffToday(now: Date, schedule: Pick<ScheduleGame, 'kickoff'>[]): boolean {
  const day = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const today = day(now);
  return schedule.some((g) => g.kickoff !== null && day(new Date(g.kickoff)) === today);
}

/**
 * The week the home page calls "the week": the latest one that is complete
 * or has at least RECAP_GAMES finals. So the morning after a Sunday it is
 * that weekend's week with Monday night still to play, and the day after a
 * lone Thursday game it is still the week before. Results and questionable
 * calls name it, so they cannot disagree.
 */
export function homeWeek(schedule: Game[]): number | null {
  const weeks = [...new Set(schedule.map((g) => g.week))].sort((a, b) => b - a);
  for (const week of weeks) {
    const games = schedule.filter((g) => g.week === week);
    const finals = games.filter(isFinal).length;
    if (finals > 0 && (finals === games.length || finals >= RECAP_GAMES)) return week;
  }
  return null;
}

/**
 * The week whose questionable calls the home page shows: the home week if
 * it has graded decisions, else the latest earlier week that does.
 */
export function callsWeek(homeWeekNumber: number | null, decisionWeeks: number[]): number | null {
  if (homeWeekNumber === null) return null;
  const weeks = decisionWeeks.filter((w) => w <= homeWeekNumber);
  return weeks.length === 0 ? null : Math.max(...weeks);
}
