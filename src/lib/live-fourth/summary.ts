/**
 * Every 4th down snap in an ESPN game summary (/summary?event=), the live
 * 4th down page's source of truth. The scoreboard poll only says when to
 * read it again.
 *
 * - A 4th down is a play whose start is 4th down and that is a snap: a run,
 *   pass, sack, punt, field goal or turnover. Timeouts, the two-minute
 *   warning and penalties carry down 4 too and are left out (a pre-snap
 *   foul is not a decision; the snap after it is).
 * - Plays are keyed by ESPN's play id: the newest play can appear in both
 *   the previous drives and the current drive.
 * - Field position is `start.yardLine` (from the home team's goal line)
 *   with the team that had the ball, as on the scoreboard (snapshot.ts);
 *   `yardsToEndzone` is never read.
 * - A play's scores are after it, so the score before the snap is the
 *   previous play's.
 * - Timeouts are counted from the plays: "Timeout #2 by PIT" is PIT's
 *   second of the half, so it has 3 minus the highest number so far in that
 *   half (2 in overtime). A timeout charged inside another play's text (a
 *   lost challenge) is not counted.
 */
import { isObject, type Json } from '../live-ticker/json.ts';
import { yardline100 } from './snapshot.ts';

export interface SummaryFourthDown {
  /** ESPN play id */
  id: string;
  event: string;
  /** Order in the game (ESPN's sequenceNumber, else position) */
  sequence: number;
  period: number;
  /** "4:41" */
  clock: string;
  type: string;
  text: string;
  /** ESPN team id with the ball */
  teamId: string;
  /** Yards to the offense's goal line */
  yardline100: number;
  distance: number;
  /** Score before the snap */
  homeScore: number;
  awayScore: number;
  /** Timeouts left before the snap, counted from the summary's timeout plays */
  homeTimeouts: number;
  awayTimeouts: number;
  /** ISO time ESPN gives the play, if any */
  wallclock: string | null;
}

export interface SummaryGame {
  event: string;
  homeId: string;
  awayId: string;
  fourthDowns: SummaryFourthDown[];
}

const SNAP = /rush|pass|sack|punt|field goal|fumble|interception|safety|touchdown|scramble/i;
const NOT_SNAP = /penalty|timeout|end |two-minute|kickoff|extra point|two point|coin toss/i;

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number.parseInt(v, 10) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
};

/** Whether a play type is a snap (not a stoppage, penalty or kick after a score). */
export const isSnapType = (type: string): boolean => SNAP.test(type) && !NOT_SNAP.test(type);

/** The 4th downs of a summary, oldest first, or null when it is not shaped as expected. */
export function parseSummary(data: unknown, event: string): SummaryGame | null {
  if (!isObject(data) || !isObject(data.header) || !isObject(data.drives)) return null;
  const competition = Array.isArray(data.header.competitions) ? data.header.competitions[0] : null;
  if (!isObject(competition) || !Array.isArray(competition.competitors)) return null;
  const idOf = (side: string) => {
    const c = (competition.competitors as unknown[]).find((x): x is Json => isObject(x) && x.homeAway === side);
    return c && isObject(c.team) && typeof c.team.id === 'string' ? c.team.id : null;
  };
  const homeId = idOf('home');
  const awayId = idOf('away');
  if (!homeId || !awayId) return null;
  const abbrOf = (side: string) => {
    const c = (competition.competitors as unknown[]).find((x): x is Json => isObject(x) && x.homeAway === side);
    return c && isObject(c.team) && typeof c.team.abbreviation === 'string' ? c.team.abbreviation : null;
  };
  const sideOfAbbr = new Map([[abbrOf('home'), 'home'], [abbrOf('away'), 'away']]);

  const drives: unknown[] = [
    ...(Array.isArray(data.drives.previous) ? data.drives.previous : []),
    ...(isObject(data.drives.current) ? [data.drives.current] : []),
  ];
  const seen = new Set<string>();
  const plays: Json[] = [];
  for (const drive of drives) {
    if (!isObject(drive) || !Array.isArray(drive.plays)) continue;
    for (const play of drive.plays) {
      if (!isObject(play) || typeof play.id !== 'string' || seen.has(play.id)) continue;
      seen.add(play.id);
      plays.push(play);
    }
  }
  const order = (p: Json, i: number) => num(p.sequenceNumber) ?? i;
  const sorted = plays.map((p, i) => ({ p, s: order(p, i) })).sort((a, b) => a.s - b.s);

  const fourthDowns: SummaryFourthDown[] = [];
  let homeScore = 0;
  let awayScore = 0;
  // Highest timeout number used this half, per side.
  const used = { home: 0, away: 0 };
  let half = 1;
  for (const { p, s } of sorted) {
    const periodNow = isObject(p.period) ? num(p.period.number) : null;
    const halfNow = periodNow === null ? half : periodNow <= 2 ? 1 : periodNow <= 4 ? 2 : 3;
    if (halfNow !== half) {
      half = halfNow;
      used.home = 0;
      used.away = 0;
    }
    const perHalf = half === 3 ? 2 : 3;
    const start = isObject(p.start) ? p.start : {};
    const type = isObject(p.type) && typeof p.type.text === 'string' ? p.type.text : '';
    const teamId = isObject(start.team) && typeof start.team.id === 'string' ? start.team.id : null;
    const yl = yardline100(num(start.yardLine), teamId, homeId);
    const distance = num(start.distance);
    const period = isObject(p.period) ? num(p.period.number) : null;
    const clock = isObject(p.clock) && typeof p.clock.displayValue === 'string' ? p.clock.displayValue : null;
    if (num(start.down) === 4 && isSnapType(type) && teamId && yl !== null && distance && period && clock) {
      fourthDowns.push({
        id: p.id as string,
        event,
        sequence: s,
        period,
        clock,
        type,
        text: typeof p.text === 'string' ? p.text.trim() : '',
        teamId,
        yardline100: yl,
        distance,
        homeScore,
        awayScore,
        homeTimeouts: Math.max(0, perHalf - used.home),
        awayTimeouts: Math.max(0, perHalf - used.away),
        wallclock: typeof p.wallclock === 'string' ? p.wallclock : null,
      });
    }
    homeScore = num(p.homeScore) ?? homeScore;
    awayScore = num(p.awayScore) ?? awayScore;
    const timeout = /Timeout #(\d+) by ([A-Z]{2,4})\b/.exec(typeof p.text === 'string' ? p.text : '');
    const side = timeout ? sideOfAbbr.get(timeout[2]) : undefined;
    if (timeout && (side === 'home' || side === 'away')) used[side] = Math.max(used[side], Number(timeout[1]));
  }
  return { event, homeId, awayId, fourthDowns };
}
