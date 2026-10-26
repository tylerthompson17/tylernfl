/**
 * The home page's moment and week (src/lib/home/state.ts), bound to the
 * build's data and clock.
 */
import excitementData from '../data/game_excitement.json';
import scheduleData from '../data/schedule.json';
import tickerData from '../data/ticker.json';
import type { GameExcitementData, ScheduleData, TickerData } from '../data/types';
import { completeWeeks } from '../lib/week/recap';
import { callsWeek, homeState, homeWeek } from '../lib/home/state';
import { getAutoChart, getFeaturedChart } from './charts';
import { decisionsData } from './decisions';
import { siteNow } from './now';

const schedule = scheduleData as ScheduleData;
const excitementFile = excitementData as GameExcitementData;
const excitement = excitementFile.season === schedule.season ? excitementFile.games : [];
const week = homeWeek(completeWeeks(schedule.games, excitement));
const decisionWeeks =
  decisionsData && decisionsData.season === schedule.season
    ? [...new Set([...decisionsData.fourthDowns, ...decisionsData.tries].filter((d) => d.graded).map((d) => d.week))]
    : [];

export const homeData = {
  state: homeState(siteNow(), schedule.games, (tickerData as TickerData).games),
  schedule,
  excitement,
  /** The week results, calls and performances all name */
  week,
  /** The week the questionable calls are from: the home week, or the latest earlier one with any */
  callsWeek: callsWeek(week, decisionWeeks),
};

/**
 * Whether the home chart is the EPA scatter (720 by 480), about 110px taller
 * at 1440 than a win probability or yards race chart (720 by 405): the main
 * column's last list shows fewer rows under it.
 */
export async function tallChart(): Promise<boolean> {
  if (await getFeaturedChart()) return false;
  return getAutoChart()?.id.includes('offense-defense') ?? false;
}
