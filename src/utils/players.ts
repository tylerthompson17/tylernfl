/**
 * The set of player pages the site builds, keyed by URL slug.
 *
 * Rosters supply almost every page. Two more cases matter:
 *  - Players who share a name have team suffixed slugs, so the bare slug
 *    (what playerSlug derives from a name) maps to all of them and renders
 *    as a disambiguation page. Links built from a name alone never
 *    dead-end.
 *  - A player in the leaderboards who is on no current roster still gets a
 *    page, so a leaderboard link never 404s.
 *
 * The same holds for players named in roster moves and injury reports.
 *
 * Full leaderboard rows carry the nflverse gsis id, which rosters carry
 * too, so those link to the exact roster page even when a name is shared.
 */
import leadersData from '../data/leaders.json';
import transactionsData from '../data/transactions.json';
import type { LeadersData, RosterPlayer, TransactionsData } from '../data/types';
import { leaderboards } from './leaderboards';
import { rosterPlayers } from './rosters';
import { playerSlug } from './slug';

const leaders = leadersData as LeadersData;
const transactions = transactionsData as TransactionsData;

export interface PlayerPage {
  name: string;
  /** Team abbr matching teams.json */
  team: string;
  slug: string;
  /** nflverse gsis id, for joining stats; null only for the rare player without one */
  playerId: string | null;
  /** Null for a player in the leaderboards but on no current roster. */
  roster: RosterPlayer | null;
}

function buildPages(): Map<string, PlayerPage[]> {
  const pages = new Map<string, PlayerPage[]>();
  const add = (slug: string, page: PlayerPage) => {
    const shared = pages.get(slug);
    if (shared) shared.push(page);
    else pages.set(slug, [page]);
  };

  for (const { player, team } of rosterPlayers) {
    add(player.slug, { name: player.name, team, slug: player.slug, playerId: player.gsisId, roster: player });
  }

  // A suffixed slug means the name is shared: collect its holders under the
  // bare slug too, which then has more than one entry.
  for (const { player, team } of rosterPlayers) {
    const base = playerSlug(player.name);
    if (base !== player.slug) {
      add(base, { name: player.name, team, slug: player.slug, playerId: player.gsisId, roster: player });
    }
  }

  // Sources with a player id come first, so an off-roster page can still
  // find the player's stats; leaders.json rows carry no id.
  const offRoster: { player: string; team: string; playerId: string | null }[] = [
    ...leaderboards.flatMap((board) => board.rows.filter((row) => !rosterSlugs.has(row.playerId))),
    // Released and retired players named in roster moves or injury reports.
    ...[...transactions.moves, ...transactions.injuries].filter((row) => !rosterSlugs.has(row.playerId)),
    ...leaders.categories.flatMap((category) => category.rows.map((row) => ({ ...row, playerId: null }))),
  ];
  for (const row of offRoster) {
    const slug = playerSlug(row.player);
    if (!pages.has(slug)) {
      add(slug, { name: row.player, team: row.team, slug, playerId: row.playerId, roster: null });
    }
  }

  return pages;
}

const rosterSlugs = new Map(
  rosterPlayers
    .filter(({ player }) => player.gsisId !== null)
    .map(({ player }) => [player.gsisId!, player.slug])
);

/** Page slug for a player known by gsis id and name: the roster's when there is one. */
export function slugForPlayer(playerId: string, name: string): string {
  return rosterSlugs.get(playerId) ?? playerSlug(name);
}

/** One entry per URL; more than one page in a value means a shared name. */
export const playerPages: Map<string, PlayerPage[]> = buildPages();
