/**
 * The site's "as of" labels (src/lib/as-of/labels.ts), bound to
 * schedule.json: the season the site is on and which of its games are final.
 * Every panel that says what its numbers are through gets its words here.
 */
import scheduleData from '../data/schedule.json';
import type { ScheduleData } from '../data/types';
import {
  gamesLabel,
  logWeekLabel,
  recapEmpty,
  seasonLabel,
  statusLine,
  throughLabel,
  weekProgress,
  type AsOfContext,
} from '../lib/as-of/labels';

const schedule = scheduleData as ScheduleData;

export const asOfContext: AsOfContext = {
  season: schedule.season,
  games: schedule.games
    .filter((g) => g.type === 'REG')
    .map((g) => ({ week: g.week, final: g.awayScore !== null && g.homeScore !== null })),
};

/** A panel's foot for a file through week N: "Through week 3." */
export const through = (season: number, throughWeek: number) =>
  throughLabel(weekProgress(asOfContext, season, throughWeek));

/** A page's intro, naming the season: "2026 regular season, through week 3." */
export const seasonThrough = (season: number, throughWeek: number) =>
  seasonLabel(weekProgress(asOfContext, season, throughWeek));

/** Whether a file from `season` is an earlier, finished season. */
export const isPriorSeason = (season: number) => season < asOfContext.season;

/** Team stats: "Through 3 games." */
export const throughGames = (season: number, low: number, high: number, perTeam = false) =>
  gamesLabel(asOfContext, season, low, high, perTeam);

export const gameStatusLine = (week: number | null, summary: string | null) => statusLine(asOfContext, week, summary);

export const logWeek = (season: number, week: number) => logWeekLabel(asOfContext, season, week);

export const emptyRecap = () => recapEmpty(asOfContext);
