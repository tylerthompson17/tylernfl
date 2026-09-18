/**
 * The transactions wire: roster moves and injury report entries read at
 * build time from transactions.json, merged into one list ranked by the
 * pipeline's priority: news (game statuses, real moves) before routine
 * items (practice squad, practice reports), starters first within each.
 */
import transactionsData from '../data/transactions.json';
import type { InjuryEntry, RosterMove, TransactionsData, WireRanking } from '../data/types';
import { slugForPlayer } from './players';

export const transactions = transactionsData as TransactionsData;

const categoryLabels = new Map(transactions.categories.map((c) => [c.key, c.label]));

export interface WireItem {
  team: string;
  fromTeam: string | null;
  player: string;
  slug: string;
  position: string | null;
  /** "84%", or empty without snaps */
  snaps: string;
  starter: boolean;
  category: string;
  categoryLabel: string;
  news: string;
  priority: number;
}

const PRACTICE_WORDS: Record<string, string> = {
  Full: 'Full practice',
  Limited: 'Limited practice',
  'Did not practice': 'Did not practice',
};

function injuryNews(entry: InjuryEntry): string {
  const lead = entry.status ?? (entry.practice ? (PRACTICE_WORDS[entry.practice] ?? entry.practice) : 'Injury report');
  return entry.injury ? `${lead}: ${entry.injury}` : lead;
}

function toItem(source: RosterMove | InjuryEntry, news: string, fromTeam: string | null): WireItem {
  const ranking: WireRanking = source;
  return {
    team: source.team,
    fromTeam,
    player: source.player,
    slug: slugForPlayer(source.playerId, source.player),
    position: source.position,
    snaps: ranking.snapShare === null ? '' : `${Math.round(ranking.snapShare * 100)}%`,
    starter: ranking.starter,
    category: ranking.category,
    categoryLabel: categoryLabels.get(ranking.category) ?? ranking.category,
    news,
    priority: ranking.priority,
  };
}

/**
 * The whole wire, biggest news first. With a team, only that team's items,
 * and a player who left it reads "Left for SEA" rather than "Joined from".
 */
export function wireItems(team?: string): WireItem[] {
  const moves = transactions.moves
    .filter((move) => !team || move.team === team || move.fromTeam === team)
    .map((move) =>
      toItem(move, team && move.fromTeam === team ? `Left for ${move.team}` : move.note, move.fromTeam)
    );
  const injuries = transactions.injuries
    .filter((entry) => !team || entry.team === team)
    .map((entry) => toItem(entry, injuryNews(entry), null));
  return [...moves, ...injuries].sort(
    (a, b) => a.priority - b.priority || a.team.localeCompare(b.team) || a.player.localeCompare(b.player)
  );
}

/** Categories that are routine churn: kept on the wire, left off the home page. */
const ROUTINE = new Set(['practice-squad', 'practice-report']);

/** The top of the wire for the home page: game statuses and real moves, starters first. */
export function headlineItems(count: number): { items: WireItem[]; rest: number } {
  const all = wireItems();
  const items = all.filter((item) => !ROUTINE.has(item.category)).slice(0, count);
  return { items, rest: all.length - items.length };
}

/** "2 out, 1 doubtful, 4 questionable", or null when no game statuses are in yet. */
export function statusSummary(entries: InjuryEntry[]): string | null {
  const counts = (['Out', 'Doubtful', 'Questionable'] as const)
    .map((status) => [status, entries.filter((entry) => entry.status === status).length] as const)
    .filter(([, n]) => n > 0)
    .map(([status, n]) => `${n} ${status.toLowerCase()}`);
  return counts.length > 0 ? counts.join(', ') : null;
}

/** Where the moves come from, for footnotes. */
export const MOVES_NOTE =
  'Moves come from comparing weekly nflverse roster snapshots, so they are dated by week, not day. ' +
  'Moves between the active roster and practice squad are left out: the data cannot tell a ' +
  'game-day call-up from a promotion.';

export const INJURY_NOTE =
  "Game statuses come with each team's last report before its game, so early in the week most " +
  'players show practice participation only.';

export const SNAPS_NOTE =
  'Snaps: share of offensive or defensive snaps over his last 8 games, this season and last. ' +
  'Game statuses and roster moves come first, then practice squad moves and practice reports; ' +
  'starters (50% of snaps or more) lead each.';
