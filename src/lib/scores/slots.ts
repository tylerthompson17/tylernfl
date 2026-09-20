/**
 * The week's games grouped into kickoff slots for the scoreboard page.
 *
 * A slot is an exact shared kickoff instant, so the grouping is the same in
 * every time zone and only its label changes. The label is built in Eastern
 * time, the convention the pipeline writes, and the browser replaces it with
 * the visitor's zone (src/lib/live-ticker/client.ts).
 */

import type { TickerGame } from '../../data/types.ts';
import { formatKickoff } from '../live-ticker/kickoff.ts';

const EASTERN = 'America/New_York';

export const TBD_LABEL = 'Time to be announced';

export interface ScoreSlot {
  /** Shared kickoff in ISO 8601 UTC, or null for games without a time yet. */
  kickoff: string | null;
  label: string;
  games: TickerGame[];
}

/** Slots in kickoff order, with any unscheduled games last. */
export function scoreSlots(games: TickerGame[]): ScoreSlot[] {
  const slots = new Map<string, ScoreSlot>();

  for (const game of games) {
    const key = game.kickoff ?? '';
    let slot = slots.get(key);
    if (!slot) {
      const label = game.kickoff && formatKickoff(game.kickoff, 'en-US', EASTERN);
      slot = { kickoff: game.kickoff, label: label || TBD_LABEL, games: [] };
      slots.set(key, slot);
    }
    slot.games.push(game);
  }

  return [...slots.values()].sort((a, b) => {
    if (!a.kickoff || !b.kickoff) return Number(!a.kickoff) - Number(!b.kickoff);
    return Date.parse(a.kickoff) - Date.parse(b.kickoff);
  });
}
