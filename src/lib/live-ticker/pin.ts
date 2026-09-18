/**
 * Where a game belongs on the ticker, and when a score counts as changed.
 * Pure functions so they run under Node's test runner; client.ts applies
 * them to the DOM.
 *
 * Live games sit in a pinned group ahead of the scrolling strip. When one
 * goes final it rejoins the strip with the other finals, which lead the
 * strip ahead of upcoming games (the same order the page renders).
 */

import type { LiveState } from './espn.ts';

/**
 * Index in the strip where a game leaving the pinned group goes: after the
 * last final, so finals stay together ahead of upcoming games.
 */
export function stripInsertIndex(stripStates: LiveState[]): number {
  let index = 0;
  stripStates.forEach((state, i) => {
    if (state === 'final') index = i + 1;
  });
  return index;
}

/**
 * Whether a score update is a change worth marking: the slot already
 * showed a number and the new one differs. Filling an empty score (the
 * first poll after the page loads mid game) is not a change.
 */
export function scoreChanged(shown: string, next: number | null): boolean {
  if (next === null || shown.trim() === '') return false;
  return Number(shown) !== next;
}
