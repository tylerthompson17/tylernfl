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
 */
import leadersData from '../data/leaders.json';
import type { LeadersData, RosterPlayer } from '../data/types';
import { rosterPlayers } from './rosters';
import { playerSlug } from './slug';

const leaders = leadersData as LeadersData;

export interface PlayerPage {
  name: string;
  /** Team abbr matching teams.json */
  team: string;
  slug: string;
  /** Null for a player in the leaderboards but on no current roster. */
  roster: RosterPlayer | null;
}

export interface LeaderLine {
  label: string;
  valueLabel: string;
  rank: number;
  value: number;
}

function buildPages(): Map<string, PlayerPage[]> {
  const pages = new Map<string, PlayerPage[]>();
  const add = (slug: string, page: PlayerPage) => {
    const shared = pages.get(slug);
    if (shared) shared.push(page);
    else pages.set(slug, [page]);
  };

  for (const { player, team } of rosterPlayers) {
    add(player.slug, { name: player.name, team, slug: player.slug, roster: player });
  }

  // A suffixed slug means the name is shared: collect its holders under the
  // bare slug too, which then has more than one entry.
  for (const { player, team } of rosterPlayers) {
    const base = playerSlug(player.name);
    if (base !== player.slug) {
      add(base, { name: player.name, team, slug: player.slug, roster: player });
    }
  }

  for (const category of leaders.categories) {
    for (const row of category.rows) {
      const slug = playerSlug(row.player);
      if (!pages.has(slug)) {
        add(slug, { name: row.player, team: row.team, slug, roster: null });
      }
    }
  }

  return pages;
}

/** One entry per URL; more than one page in a value means a shared name. */
export const playerPages: Map<string, PlayerPage[]> = buildPages();

/** This player's current leaderboard appearances, empty when they have none. */
export function leaderLines(page: PlayerPage): LeaderLine[] {
  const slug = playerSlug(page.name);
  return leaders.categories.flatMap((category) =>
    category.rows
      .filter((row) => playerSlug(row.player) === slug && row.team === page.team)
      .map((row) => ({
        label: category.label,
        valueLabel: category.valueLabel,
        rank: row.rank,
        value: row.value,
      }))
  );
}
