/**
 * Matching and ranking for the header search. Pure functions so they run
 * under Node's test runner; the index is built by src/utils/search-index.ts
 * and the DOM wiring is in dom.ts.
 */

export type EntryKind = 'player' | 'team' | 'page';

export interface SearchEntry {
  kind: EntryKind;
  /** What the result shows, e.g. "Josh Allen" */
  label: string;
  /** The dim second part, e.g. "QB, BUF" */
  detail: string;
  href: string;
  /** Extra words that match but are not shown, e.g. a team's abbreviation */
  terms: string;
  /** Tie-breaker among players: higher for players with a stat line or an active roster spot */
  weight: number;
}

/** Lowercase, accents dropped, periods and apostrophes removed, other punctuation to spaces. */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/['.’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const KIND_BONUS: Record<EntryKind, number> = { team: 15, page: 5, player: 0 };

/**
 * Score an entry for a normalized query, or null when it does not match.
 * Every query word has to be the start of some word in the label or terms.
 */
export function score(entry: SearchEntry, query: string): number | null {
  const tokens = query.split(' ').filter(Boolean);
  if (tokens.length === 0) return null;
  const label = normalize(entry.label);
  const labelWords = label.split(' ');
  const allWords = [...labelWords, ...normalize(entry.terms).split(' ')];
  if (!tokens.every((token) => allWords.some((word) => word.startsWith(token)))) return null;

  let total = KIND_BONUS[entry.kind] + entry.weight;
  if (label === query) total += 100;
  else if (label.startsWith(query)) total += 50;
  if (tokens.every((token) => labelWords.some((word) => word.startsWith(token)))) total += 20;
  return total;
}

/** The best `limit` entries for what was typed, best first. */
export function search(entries: SearchEntry[], typed: string, limit = 8): SearchEntry[] {
  const query = normalize(typed);
  if (!query) return [];
  return entries
    .map((entry) => ({ entry, score: score(entry, query) }))
    .filter((hit): hit is { entry: SearchEntry; score: number } => hit.score !== null)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.entry.label.length - b.entry.label.length ||
        a.entry.label.localeCompare(b.entry.label)
    )
    .slice(0, limit)
    .map((hit) => hit.entry);
}
