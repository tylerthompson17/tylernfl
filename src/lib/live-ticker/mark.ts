/**
 * The live mark on a ticker slot: a word under the clock, and a pale yellow
 * tint, for a game in progress worth switching to. Read only from the
 * scoreboard poll (scores, period, status and each team's line scores);
 * ESPN's win probability, which the response also carries, is not used.
 *
 * First match wins, in this order:
 * - Comeback: a team that trailed by 14 or more at the end of any
 *   completed quarter is now within 8, or leading.
 * - Close game: the fourth quarter or overtime, within 8.
 * - Shootout: 50 or more points between them, within 8.
 *
 * These are round thresholds the site chose, like the leaderboard
 * qualifiers: 8 is one score, 14 two. Only live games are marked; a
 * finished game's label comes from the pipeline and is shown on /scores
 * and /week, never in the ticker.
 */

export const LIVE_MARKS = ['Comeback', 'Close game', 'Shootout'] as const;
export type LiveMark = (typeof LIVE_MARKS)[number];

export const ONE_SCORE = 8;
export const TWO_SCORES = 14;
export const SHOOTOUT_POINTS = 50;

export interface MarkInput {
  /** ESPN's period: 1 to 4, then 5 and on for overtime */
  period: number;
  /** ESPN's status type name, e.g. STATUS_IN_PROGRESS, STATUS_HALFTIME */
  status: string;
  awayScore: number;
  homeScore: number;
  /** Points per period, first quarter first; may include the period under way */
  awayLines: number[];
  homeLines: number[];
}

/**
 * How many periods are over. In progress, every period before the current
 * one; at halftime or at the end of a period, the current one too.
 */
export function completedPeriods(period: number, status: string): number {
  if (status === 'STATUS_HALFTIME' || status === 'STATUS_END_PERIOD') return period;
  return Math.max(0, period - 1);
}

/**
 * Whether either team trailed by TWO_SCORES or more at the end of a
 * completed period and is now within ONE_SCORE or ahead. Needs line scores
 * for every completed period; without them there is no comeback to see.
 */
function isComeback(game: MarkInput): boolean {
  const done = completedPeriods(game.period, game.status);
  if (game.awayLines.length < done || game.homeLines.length < done) return false;
  let away = 0;
  let home = 0;
  let awayWasDown = false;
  let homeWasDown = false;
  for (let i = 0; i < done; i++) {
    away += game.awayLines[i]!;
    home += game.homeLines[i]!;
    if (home - away >= TWO_SCORES) awayWasDown = true;
    if (away - home >= TWO_SCORES) homeWasDown = true;
  }
  return (
    (awayWasDown && game.homeScore - game.awayScore <= ONE_SCORE) ||
    (homeWasDown && game.awayScore - game.homeScore <= ONE_SCORE)
  );
}

export function liveMark(game: MarkInput): LiveMark | null {
  const margin = Math.abs(game.homeScore - game.awayScore);
  if (isComeback(game)) return 'Comeback';
  if (game.period >= 4 && margin <= ONE_SCORE) return 'Close game';
  if (game.homeScore + game.awayScore >= SHOOTOUT_POINTS && margin <= ONE_SCORE) return 'Shootout';
  return null;
}
