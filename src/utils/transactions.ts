/**
 * Roster moves and the injury report read at build time from
 * transactions.json, shaped into StatTable rows.
 */
import transactionsData from '../data/transactions.json';
import type { InjuryEntry, RosterMove, TransactionsData } from '../data/types';
import { slugForPlayer } from './players';

export const transactions = transactionsData as TransactionsData;

/** Moves for one team: its own, plus players who left it for another team. */
export function movesFor(abbr: string): RosterMove[] {
  return transactions.moves.filter((move) => move.team === abbr || move.fromTeam === abbr);
}

export function injuriesFor(abbr: string): InjuryEntry[] {
  return transactions.injuries.filter((entry) => entry.team === abbr);
}

/**
 * The note from a team's point of view: a player who joined another team
 * reads "Left for SEA" on the team he left.
 */
function noteFor(move: RosterMove, abbr?: string): string {
  return abbr && move.fromTeam === abbr ? `Left for ${move.team}` : move.note;
}

export function moveRows(moves: RosterMove[], abbr?: string) {
  return moves.map((move) => ({
    team: move.team,
    player: move.player,
    slug: slugForPlayer(move.playerId, move.player),
    position: move.position,
    move: noteFor(move, abbr),
  }));
}

export function injuryRows(entries: InjuryEntry[]) {
  return entries.map((entry) => ({
    team: entry.team,
    player: entry.player,
    slug: slugForPlayer(entry.playerId, entry.player),
    position: entry.position,
    injury: entry.injury,
    practice: entry.practice,
    status: entry.status ?? '',
  }));
}

/** "2 out, 1 doubtful, 4 questionable", or null when no game statuses are in yet. */
export function statusSummary(entries: InjuryEntry[]): string | null {
  const counts = (['Out', 'Doubtful', 'Questionable'] as const)
    .map((status) => [status, entries.filter((entry) => entry.status === status).length] as const)
    .filter(([, n]) => n > 0)
    .map(([status, n]) => `${n} ${status.toLowerCase()}`);
  return counts.length > 0 ? counts.join(', ') : null;
}

/** Sentence under a moves table explaining where the moves come from. */
export const MOVES_NOTE =
  'Moves come from comparing weekly nflverse roster snapshots, so they are dated by week, not day. ' +
  'Moves between the active roster and practice squad are left out: the data cannot tell a ' +
  'game-day call-up from a promotion.';

export const INJURY_NOTE =
  "Game statuses come with each team's last report before its game, so early in the week most " +
  'players show practice participation only.';
