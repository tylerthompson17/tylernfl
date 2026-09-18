/**
 * Filtering for the transactions wire: by team, by category, starters
 * only. Pure functions so they run under Node's test runner; the DOM
 * wiring is in dom.ts. Filters live in the URL (?team=BUF&type=reserve)
 * so a team page can link straight to its slice and a view can be shared.
 */

export interface WireFilter {
  team: string | null;
  category: string | null;
  startersOnly: boolean;
}

export interface WireRowSpec {
  team: string;
  /** Previous team, for players who left this one for another */
  fromTeam: string | null;
  category: string;
  starter: boolean;
}

export const NO_FILTER: WireFilter = { team: null, category: null, startersOnly: false };

/** A player who left a team shows under that team too. */
export function matches(row: WireRowSpec, filter: WireFilter, ignoreCategory = false): boolean {
  if (filter.team && row.team !== filter.team && row.fromTeam !== filter.team) return false;
  if (filter.startersOnly && !row.starter) return false;
  if (!ignoreCategory && filter.category && row.category !== filter.category) return false;
  return true;
}

/** Items per category under the team and starters filters, for the category buttons. */
export function countByCategory(rows: WireRowSpec[], filter: WireFilter): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (matches(row, filter, true)) counts.set(row.category, (counts.get(row.category) ?? 0) + 1);
  }
  return counts;
}

/** Read a filter from a query string, ignoring values that are not real teams or categories. */
export function parseFilter(search: string, teams: Set<string>, categories: Set<string>): WireFilter {
  const params = new URLSearchParams(search);
  const team = params.get('team')?.toUpperCase() ?? null;
  const category = params.get('type');
  return {
    team: team && teams.has(team) ? team : null,
    category: category && categories.has(category) ? category : null,
    startersOnly: params.get('starters') === '1',
  };
}

export function serializeFilter(filter: WireFilter): string {
  const params = new URLSearchParams();
  if (filter.team) params.set('team', filter.team);
  if (filter.category) params.set('type', filter.category);
  if (filter.startersOnly) params.set('starters', '1');
  const query = params.toString();
  return query ? `?${query}` : '';
}
