/** When the live ticker should poll, and how often. */

export const POLL_INTERVAL_MS = 30_000;
export const MAX_BACKOFF_MS = 5 * 60_000;
export const REQUEST_TIMEOUT_MS = 8_000;

const BEFORE_KICKOFF_MS = 15 * 60_000;
const GAME_LENGTH_MS = 4.5 * 60 * 60_000;

export interface ScheduledGame {
  kickoff: Date | null;
  state: 'pre' | 'live' | 'final';
}

export interface PollWindow {
  active: boolean;
  /** Start of the next window when not active, or null if none remain. */
  nextStart: Date | null;
}

/**
 * Each unfinished game has its own window, from 15 minutes before kickoff to
 * 4.5 hours after, so Thursday, Sunday, and Monday games poll separately
 * instead of polling through the days in between.
 */
export function pollWindow(games: ScheduledGame[], now: Date): PollWindow {
  let nextStart: Date | null = null;
  for (const game of games) {
    if (game.state === 'final' || !game.kickoff) continue;
    const start = game.kickoff.getTime() - BEFORE_KICKOFF_MS;
    const end = game.kickoff.getTime() + GAME_LENGTH_MS;
    const t = now.getTime();
    if (t >= start && t <= end) return { active: true, nextStart: null };
    if (start > t && (!nextStart || start < nextStart.getTime())) nextStart = new Date(start);
  }
  return { active: false, nextStart };
}

/** Delay before the next request after `failures` consecutive failures. */
export function retryDelay(failures: number): number {
  return Math.min(POLL_INTERVAL_MS * 2 ** failures, MAX_BACKOFF_MS);
}

const STATE_RANK = { pre: 0, live: 1, final: 2 } as const;

/** Live data never moves a game backwards (a final game stays final). */
export function isAdvance(current: ScheduledGame['state'], next: ScheduledGame['state']): boolean {
  return STATE_RANK[next] >= STATE_RANK[current];
}

// Long enough to reach the next daily data run from any kickoff, with room
// for GitHub starting that run hours late (it has).
const CATCH_UP_MS = 48 * 60 * 60_000;

/**
 * Whether a game's live window has closed with ticker.json still showing
 * it unfinished: it kicked off within the last 48 hours, is past its
 * window, and is not final. The page then makes one scoreboard request on
 * load to pick up the result, since ticker.json only catches up at the
 * next daily run (6 AM Eastern, after a Monday night game ends near
 * midnight). One request, not polling.
 */
export function needsCatchUp(games: ScheduledGame[], now: Date): boolean {
  const t = now.getTime();
  return games.some((game) => {
    if (game.state === 'final' || !game.kickoff) return false;
    const kickoff = game.kickoff.getTime();
    return t > kickoff + GAME_LENGTH_MS && t - kickoff <= CATCH_UP_MS;
  });
}
