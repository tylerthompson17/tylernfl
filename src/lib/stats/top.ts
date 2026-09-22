/**
 * The top of a list for the stats overview panels: best first, equal
 * values sharing a rank, at most `limit` rows. When the last place shown
 * is shared by more players than fit, the rest are counted rather than
 * listed, so early in the season an interceptions panel does not run to
 * twenty rows of players with one.
 */

export interface Ranked<T> {
  rank: number;
  item: T;
}

export interface Top<T> {
  rows: Ranked<T>[];
  /** Players tied with the last row shown who did not fit. */
  moreTied: number;
  /** The value they are tied on, when moreTied > 0. */
  tiedValue: number | null;
}

export interface TopOptions<T> {
  value: (item: T) => number | null;
  /** Tie order among equal values: by name, so a rebuild keeps the order. */
  name: (item: T) => string;
  limit?: number;
  /** Counting stats: only values above zero lead anything. */
  positiveOnly?: boolean;
}

export function topOf<T>(items: T[], { value, name, limit = 5, positiveOnly = false }: TopOptions<T>): Top<T> {
  const scored = items
    .map((item) => ({ item, v: value(item) }))
    .filter((s): s is { item: T; v: number } => s.v !== null && (!positiveOnly || s.v > 0))
    .sort((a, b) => b.v - a.v || name(a.item).localeCompare(name(b.item)));

  const ranked = scored.map((s) => ({ rank: 1 + scored.filter((o) => o.v > s.v).length, item: s.item, v: s.v }));
  const shown = ranked.slice(0, limit);
  const last = shown.at(-1);
  const moreTied = last ? ranked.slice(limit).filter((r) => r.v === last.v).length : 0;
  return {
    rows: shown.map(({ rank, item }) => ({ rank, item })),
    moreTied,
    tiedValue: moreTied > 0 && last ? last.v : null,
  };
}
