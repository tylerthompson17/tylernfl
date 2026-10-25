/**
 * The daily 4th down game's rules and words (/fourth-down/daily/), shared
 * by the page at build time and its script: the situation from either
 * side's view (team names hidden or shown), nfl4th's estimate, what each
 * pick gave up, the score, the shareable text, and streaks and history
 * from the visitor's own record. Every number is nfl4th's estimate, so the
 * words never say a pick was correct or wrong: only how it compares.
 */
import type { DailyFourthData, DailyFourthPlay, DriveResult } from '../../data/types';
import type { FourthDownCall } from '../fourth-down';

export const CALLS: FourthDownCall[] = ['go', 'punt', 'field goal'];

/** What scoring reads from a play: all the page script is given. */
export type ScoredPlay = Pick<DailyFourthPlay, 'wp' | 'call' | 'coachWpLost'>;

/** The day's game as the page script has it. */
export type ScoredGame = Pick<DailyFourthData, 'date' | 'number'> & { plays: ScoredPlay[] };

const CALL_WORDS: Record<FourthDownCall, string> = { go: 'Go for it', punt: 'Punt', 'field goal': 'Field goal' };
const DID_WORDS: Record<FourthDownCall, string> = {
  go: 'went for it',
  punt: 'punted',
  'field goal': 'kicked a field goal',
};

export const callWords = (call: FourthDownCall): string => CALL_WORDS[call];

/** Points of win probability, one decimal: 0.0842 is "8.4". */
export const points = (wp: number): string => (Math.max(wp, 0) * 100).toFixed(1);

/** "8.4 points": always a decimal, so always plural; "less than 0.1 points" for a gap that rounds to nothing. */
const pointsWords = (wp: number): string => (wp > 0 && points(wp) === '0.0' ? 'less than 0.1 points' : `${points(wp)} points`);

/** The options the model allows on this play, in a fixed order. */
export const optionsOf = (p: DailyFourthPlay): FourthDownCall[] => CALLS.filter((c) => p.wp[c] !== null);

/** WP a pick gave up against nfl4th's call, 0 for the call itself. */
export function wpLost(p: ScoredPlay, pick: FourthDownCall): number {
  const chosen = p.wp[pick];
  const best = p.wp[p.call];
  if (chosen === null || best === null) return 0;
  return Math.max(Math.round((best - chosen) * 1e5) / 1e5, 0);
}

/** "4th and 4", or "4th and goal" when the line to gain is the goal line. */
export const downWords = (p: DailyFourthPlay): string =>
  `4th and ${p.distance >= p.yardline100 ? 'goal' : p.distance}`;

/** "Own 49", "Opponent's 23", "Midfield"; with names, "IND 49", "TB 23". */
export function fieldWords(p: DailyFourthPlay, names: boolean): string {
  if (p.yardline100 === 50) return 'Midfield';
  if (p.yardline100 > 50) return `${names ? p.offense : 'Own'} ${100 - p.yardline100}`;
  return `${names ? p.defense : "Opponent's"} ${p.yardline100}`;
}

/** "Tied", "Up 3", "Down 7"; with names, "IND up 3", "Tied". */
export function scoreWords(p: DailyFourthPlay, names: boolean): string {
  if (p.scoreDiff === 0) return 'Tied';
  const how = `${p.scoreDiff > 0 ? 'up' : 'down'} ${Math.abs(p.scoreDiff)}`;
  return names ? `${p.offense} ${how}` : `${how.charAt(0).toUpperCase()}${how.slice(1)}`;
}

/** "4th quarter, 0:34". */
export function clockWords(p: DailyFourthPlay): string {
  const ord = ['1st', '2nd', '3rd', '4th'][p.quarter - 1];
  const m = Math.floor(p.clock / 60);
  const s = String(p.clock % 60).padStart(2, '0');
  return `${ord} quarter, ${m}:${s}`;
}

/** "Offense 1, defense 3"; with names, "IND 1, KC 3". */
export function timeoutWords(p: DailyFourthPlay, names: boolean): string {
  return names
    ? `${p.offense} ${p.timeoutsOffense}, ${p.defense} ${p.timeoutsDefense}`
    : `Offense ${p.timeoutsOffense}, defense ${p.timeoutsDefense}`;
}

/** "Week 2: IND at KC". */
export const gameWords = (p: DailyFourthPlay): string => `Week ${p.week}: ${p.away} at ${p.home}`;

/** "nfl4th says Go for it, by 8.4 points." or, under the close margin, a close call. */
export function nfl4thLine(p: DailyFourthPlay): string {
  return p.close
    ? `A close call: nfl4th leaned ${callWords(p.call)}, by ${pointsWords(p.margin)}.`
    : `nfl4th says ${callWords(p.call)}, by ${pointsWords(p.margin)}.`;
}

/** How a pick compares with nfl4th's estimate. */
export function pickLine(p: ScoredPlay, pick: FourthDownCall): string {
  if (pick === p.call) return `You picked ${callWords(pick)}, the same as nfl4th.`;
  return `You picked ${callWords(pick)}: ${pointsWords(wpLost(p, pick))} of win probability below nfl4th's estimate for ${callWords(p.call)}.`;
}

/** "Shane Steichen's IND punted: Punted 41 yards." plus how it compares. */
export function coachLine(p: DailyFourthPlay): string {
  const did = `${p.coach}'s ${p.offense} ${DID_WORDS[p.teamCall]}`;
  const vs = p.teamCall === p.call ? ', the same as nfl4th' : `, ${pointsWords(p.coachWpLost)} below nfl4th's estimate`;
  return `${did}${vs}.`;
}

const RESULT_WORDS: Record<DriveResult, string> = {
  touchdown: 'touchdown',
  'field goal': 'field goal',
  'missed field goal': 'missed field goal',
  punt: 'punt',
  turnover: 'turnover',
  'turnover on downs': 'turnover on downs',
  'opponent touchdown': 'touchdown',
  safety: 'safety',
  'end of half': 'end of the half',
  'end of regulation': 'end of regulation',
  'end of game': 'end of game',
};

const count = (n: number, word: string): string => `${n} ${word}${Math.abs(n) === 1 ? '' : 's'}`;

/** "KC 16" or "midfield", from yards to the other team's goal line. */
function spotOf(yardline100: number, team: string, other: string): string {
  if (yardline100 === 50) return 'midfield';
  return yardline100 > 50 ? `the ${team} ${100 - yardline100}` : `the ${other} ${yardline100}`;
}

/**
 * What happened after the 4th down, from the file's `next`: the offense's
 * drive after a conversion, else the next possession. "KC took over at the
 * KC 16: 5 plays, 61 yards, field goal." Null when the file has none.
 */
export function nextLine(p: DailyFourthPlay): string | null {
  const n = p.next;
  if (!n) return null;
  const d = n.drive;
  if (!d) {
    const other = p.defense;
    if (n.ended === 'touchdown') return `${other} scored a touchdown on the return.`;
    if (n.ended === 'half') return `The half ended before ${other} had the ball.`;
    if (n.ended === 'regulation') return `Regulation ended before ${other} had the ball.`;
    if (n.ended === 'game') return `The game ended before ${other} had the ball.`;
    return null;
  }
  const other = d.team === p.offense ? p.defense : p.offense;
  const result =
    d.result === null ? null : d.result === 'opponent touchdown' ? `${other} touchdown` : RESULT_WORDS[d.result];
  const stats = `${count(d.plays, 'play')}, ${count(d.yards, 'yard')}`;
  if (n.converted) {
    const end =
      result === null ? 'The drive' : d.result!.startsWith('end of') ? `The drive ran to the ${result}` : `The drive ended in a ${result}`;
    return `${end}: ${stats} in all.`;
  }
  const at = d.startYardline100 === null ? 'had the ball next' : `took over at ${spotOf(d.startYardline100, d.team, other)}`;
  return `${d.team} ${at}: ${stats}${result === null ? '' : `, ${result}`}.`;
}

/** "Final: IND 30, KC 33 in overtime." */
export function finalLine(p: DailyFourthPlay): string | null {
  if (!p.next) return null;
  const f = p.next.final;
  return `Final: ${p.away} ${f.away}, ${p.home} ${f.home}${f.overtime ? ' in overtime' : ''}.`;
}

export const NOISY = 'Outcomes are noisy: a good call can still go badly.';

export interface Score {
  /** Your WP lost against nfl4th's call over the plays picked */
  you: number;
  /** The coaches' WP lost on the same plays */
  coaches: number;
  /** Plays where your pick was nfl4th's call */
  same: number;
}

export function scoreOf(plays: ScoredPlay[], picks: FourthDownCall[]): Score {
  let you = 0;
  let coaches = 0;
  let same = 0;
  picks.forEach((pick, i) => {
    const p = plays[i];
    you += wpLost(p, pick);
    coaches += p.coachWpLost;
    if (pick === p.call) same += 1;
  });
  return { you, coaches, same };
}

/** "You gave up 4.2 points ... The coaches gave up 7.9." */
export function scoreLine(s: Score, plays: number): string {
  const compare =
    points(s.you) === points(s.coaches)
      ? 'the same as the coaches'
      : s.you < s.coaches
        ? `${pointsWords(s.coaches - s.you)} less than the coaches`
        : `${pointsWords(s.you - s.coaches)} more than the coaches`;
  return `You gave up ${pointsWords(s.you)} of win probability against nfl4th's estimates, ${compare} (${pointsWords(s.coaches)}). You matched nfl4th on ${s.same} of ${plays}.`;
}

/** "October 25, 2026", from the game's Eastern date. */
export function dateWords(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const month = new Date(Date.UTC(y, m - 1, d)).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
  return `${month} ${d}, ${y}`;
}

/** The plain text a player shares: no spoilers of the plays, only how each pick compared. */
export function shareText(game: ScoredGame, picks: FourthDownCall[], link: string): string {
  const s = scoreOf(game.plays, picks);
  const lines = picks.map((pick, i) => {
    const lost = wpLost(game.plays[i], pick);
    const shown = lost === 0 ? 'Same as nfl4th' : points(lost) === '0.0' ? 'Under 0.1 below nfl4th' : `-${points(lost)}`;
    return `${i + 1}. ${shown}`;
  });
  return [
    `4th down daily #${game.number}, ${dateWords(game.date)}`,
    ...lines,
    `WP given up: ${points(s.you)} points (the coaches: ${points(s.coaches)})`,
    link,
  ].join('\n');
}

/** One finished day in the visitor's own record. */
export interface DayRecord {
  number: number;
  date: string;
  picks: FourthDownCall[];
  wpLost: number;
  coachWpLost: number;
}

/** What the page keeps in localStorage: finished days, and today's picks so far. */
export interface Store {
  v: 1;
  days: DayRecord[];
  progress: { number: number; picks: FourthDownCall[] } | null;
  names: boolean;
}

export const emptyStore = (): Store => ({ v: 1, days: [], progress: null, names: false });

/** A stored value read back, or an empty record when it is missing or not ours. */
export function parseStore(raw: string | null): Store {
  if (!raw) return emptyStore();
  try {
    const s = JSON.parse(raw) as Partial<Store>;
    if (s.v !== 1 || !Array.isArray(s.days)) return emptyStore();
    return { v: 1, days: s.days, progress: s.progress ?? null, names: s.names === true };
  } catch {
    return emptyStore();
  }
}

/** The record with a pick added to today's game, and the day filed once it has every play. */
export function withPick(store: Store, game: ScoredGame, pick: FourthDownCall): Store {
  if (store.days.some((d) => d.number === game.number)) return store;
  const before = store.progress?.number === game.number ? store.progress.picks : [];
  const picks = [...before, pick].slice(0, game.plays.length);
  if (picks.length < game.plays.length) return { ...store, progress: { number: game.number, picks } };
  const s = scoreOf(game.plays, picks);
  const day: DayRecord = { number: game.number, date: game.date, picks, wpLost: s.you, coachWpLost: s.coaches };
  const days = [...store.days, day].sort((a, b) => a.number - b.number);
  return { ...store, days, progress: null };
}

/** Today's picks so far, or every pick when today is finished. */
export function picksFor(store: Store, game: ScoredGame): FourthDownCall[] {
  const done = store.days.find((d) => d.number === game.number);
  if (done) return done.picks;
  return store.progress?.number === game.number ? store.progress.picks : [];
}

/**
 * Days in a row played. The current streak runs back from today's game,
 * or from yesterday's while today's is still to finish, so it is not lost
 * before the visitor has had the chance to play.
 */
export function streaks(store: Store, today: number): { current: number; best: number; played: number } {
  const played = new Set(store.days.map((d) => d.number));
  let current = 0;
  for (let n = played.has(today) ? today : today - 1; played.has(n); n -= 1) current += 1;
  let best = 0;
  let run = 0;
  let last = Number.NaN;
  for (const n of [...played].sort((a, b) => a - b)) {
    run = n === last + 1 ? run + 1 : 1;
    best = Math.max(best, run);
    last = n;
  }
  return { current, best, played: played.size };
}
