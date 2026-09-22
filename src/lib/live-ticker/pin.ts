/**
 * Where a game belongs on the ticker, and when a score counts as changed.
 * Pure functions so they run under Node's test runner; client.ts applies
 * them to the DOM.
 *
 * Live games sit in a pinned group ahead of the scrolling strip. When one
 * goes final it rejoins the strip with the other finals, which lead the
 * strip ahead of upcoming games (the same order the page renders).
 *
 * The pinned group takes the width it needs, so the strip gets the
 * remainder and can be squeezed out entirely on a full slate.
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

/**
 * Roughly one game slot: the kickoff or clock detail, the gap, and the
 * team and score columns. Mirrors the .game widths in BaseLayout.
 */
export const MIN_STRIP_PX = 160;

/**
 * Whether the strip of finished and upcoming games still earns its place
 * in the row, given the width the live games left it. A remainder under
 * one slot would show a game cut off at the row's edge, which reads as a
 * rendering fault rather than as a hint that more games are there, so the
 * strip is dropped until games end and give the width back.
 */
export function showsStrip(available: number, stripGames: number): boolean {
  return stripGames > 0 && available >= MIN_STRIP_PX;
}

/** The carousel rests this long on each game, then takes this long to move. */
export const CAROUSEL_REST_MS = 3000;
export const CAROUSEL_MOVE_MS = 400;

/**
 * How far the carousel has moved after `steps` steps: the widths of the
 * first `steps` slots, measured now. The carousel moves one whole game at
 * a time, so it always rests on a slot's edge and the leftmost game starts
 * right at the week label, never half under it. Measuring each time rather
 * than adding up as it goes keeps it on an edge when a live score changes
 * a slot's width.
 */
export function carouselOffset(widths: number[], steps: number): number {
  let offset = 0;
  for (let i = 0; i < steps && i < widths.length; i++) offset += widths[i]!;
  return offset;
}
