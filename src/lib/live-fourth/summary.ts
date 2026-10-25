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
 * - A play on 4th down wiped out by a penalty after the snap is listed too,
 *   with the foul (`nullified`), and is never graded; a pre-snap foul (no
 *   play described before the penalty) is not a decision and is left out.
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
  /** The foul that wiped the play out ("Defensive Offside"); null for a play that stood */
  nullified: string | null;
  /**
   * Where the spot came from. ESPN's summary starts field goal plays a yard
   * short of where the scoreboard and the play text put them, so a kick's
   * spot is the scoreboard's when the page saw it live (feed.ts), else its
   * stated distance minus 17, else the summary's, marked uncertain.
   */
  spot: 'summary' | 'text' | 'scoreboard';
  /** A field goal play whose spot is the summary's alone: possibly a yard off */
  spotUncertain: boolean;
}

export interface SummaryGame {
  event: string;
  /** The game is over (the header's status) */
  final: boolean;
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

// "(4:17) (Punt formation) " and the like, and announcements that are not
// plays ("79-L.Borom reported in as eligible."), before a play's text.
const LEADING_TAGS = /^(\s*\([^)]*\))*\s*/;
const ANNOUNCEMENTS = /^(.*?reported in as eligible\.\s*)+/i;

/**
 * The foul that wiped out a penalty play's snap, or null for a pre-snap
 * foul (nothing happened before the penalty) or text without one.
 */
export function nullifyingFoul(text: string): string | null {
  const rest = text.replace(LEADING_TAGS, '').replace(ANNOUNCEMENTS, '');
  if (/^penalty/i.test(rest)) return null;
  const m = /PENALTY on [^,]+, ([^,]+?),/i.exec(text);
  return m ? m[1].trim() : null;
}

/**
 * A field goal play's spot and distance to go, from the kick distance its
 * text states ("44 yard field goal": yards to the goal line plus 17), when
 * the summary's spot is a yard or two off from it. Never for a blocked kick
 * or a play without a stated distance (a bad snap); those keep the
 * summary's spot, marked uncertain. Other plays are unchanged.
 */
export function fieldGoalSpot(
  type: string,
  text: string,
  yardline100: number,
  distance: number,
): { yardline100: number; distance: number; spot: 'summary' | 'text'; spotUncertain: boolean } {
  if (!/field goal/i.test(type)) return { yardline100, distance, spot: 'summary', spotUncertain: false };
  const stated = /(\d+) yard field goal/i.exec(text);
  if (/blocked/i.test(type) || /blocked/i.test(text) || !stated) {
    return { yardline100, distance, spot: 'summary', spotUncertain: true };
  }
  const fromText = Number(stated[1]) - 17;
  const shift = fromText - yardline100;
  if (Math.abs(shift) > 2 || fromText < 1 || fromText > 99) return { yardline100, distance, spot: 'summary', spotUncertain: true };
  // The line to gain is where it was: the distance moves with the spot,
  // and goal to go stays goal to go.
  const goal = distance >= yardline100;
  return { yardline100: fromText, distance: goal ? fromText : distance + shift, spot: 'text', spotUncertain: false };
}

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
    const text = typeof p.text === 'string' ? p.text.trim() : '';
    const foul = /^penalty$/i.test(type) ? nullifyingFoul(text) : null;
    if (num(start.down) === 4 && (isSnapType(type) || foul) && teamId && yl !== null && distance && period && clock) {
      const fg = fieldGoalSpot(type, text, yl, distance);
      fourthDowns.push({
        id: p.id as string,
        event,
        sequence: s,
        period,
        clock,
        type,
        text,
        teamId,
        yardline100: fg.yardline100,
        distance: fg.distance,
        spot: fg.spot,
        spotUncertain: fg.spotUncertain,
        homeScore,
        awayScore,
        homeTimeouts: Math.max(0, perHalf - used.home),
        awayTimeouts: Math.max(0, perHalf - used.away),
        wallclock: typeof p.wallclock === 'string' ? p.wallclock : null,
        nullified: foul,
      });
    }
    homeScore = num(p.homeScore) ?? homeScore;
    awayScore = num(p.awayScore) ?? awayScore;
    const timeout = /Timeout #(\d+) by ([A-Z]{2,4})\b/.exec(typeof p.text === 'string' ? p.text : '');
    const side = timeout ? sideOfAbbr.get(timeout[2]) : undefined;
    if (timeout && (side === 'home' || side === 'away')) used[side] = Math.max(used[side], Number(timeout[1]));
  }
  const status = isObject(competition.status) && isObject(competition.status.type) ? competition.status.type : {};
  return { event, final: status.completed === true, homeId, awayId, fourthDowns };
}
