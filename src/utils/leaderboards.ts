/**
 * Full player leaderboards read at build time from src/data/stats/. The
 * pipeline writes one file per board; this is the only place that knows.
 */
import type { LeaderboardData } from '../data/types';

const files = import.meta.glob<LeaderboardData>('../data/stats/*.json', {
  eager: true,
  import: 'default',
});

/** In the order the stats navigation lists them. */
const ORDER = ['passing', 'rushing', 'receiving', 'defense', 'kicking'];

export const leaderboards: LeaderboardData[] = Object.values(files).sort(
  (a, b) => (ORDER.indexOf(a.key) + 1 || 99) - (ORDER.indexOf(b.key) + 1 || 99)
);
