/**
 * The week's notable player performances, picked from game logs.
 *
 * A delegated method (docs/methods/notable-performances.md). Every game
 * line is placed by its headline stat in that category's history: the
 * share of team games since 1999 whose best in the stat was lower, counting
 * equal values as half (performance_percentiles.json, written by
 * pipelines/performance_percentiles.py). A 2-sack game is measured against
 * what a team's leading pass rusher usually does, a 300 yard game against
 * a team's passer. The week's lines are then ranked across categories by
 * that percentile, one row per player, and the top few are shown.
 *
 * Every line names its own stat ("327 pass yds, 4 TD at BUF") rather than
 * leaning on a category column, so a row reads on its own wherever it is
 * shown and a ranked list needs no new shape. It reads the same way every
 * time: the headline stat, then what it produced. Stats that only break
 * ties (QB hits, receptions) stay out of the text, so the widest row fits
 * the home page's half column without scrolling.
 */

/** One player's game on one board, flattened out of players/{TEAM}.json. */
export interface WeekLine {
  playerId: string;
  player: string;
  team: string;
  opponent: string;
  home: boolean;
  /** Board key: "passing", "rushing", "receiving", "defense", "kicking". */
  board: string;
  values: Record<string, number | null>;
}

export interface Performance {
  playerId: string;
  player: string;
  team: string;
  opponent: string;
  home: boolean;
  board: string;
  /** What the row is about: "Passing", "Sacks". Not always the board's name. */
  label: string;
  /** The game in words, naming its own stat: "410 pass yds, 3 TD vs DET". */
  line: string;
  /** Where the headline stat falls among team games since 1999, 0 to 1. */
  percentile: number;
}

/** One category's history: [value, team games] pairs, lowest value first. */
export interface Pool {
  stat: string;
  games: number;
  values: [number, number][];
}

interface BoardRule {
  board: string;
  label: string;
  /** Placed in the category's history by this column. */
  primary: string;
  /** Within a category, equal percentiles go to the higher value here, in order. */
  secondary: string[];
  /** The stats worth reading, without the opponent. */
  line: (values: Record<string, number | null>) => string;
}

const n = (values: Record<string, number | null>, key: string): number => values[key] ?? 0;

/** Sacks come in halves, so 2 reads as "2.0" and 2.5 stays "2.5". */
const sacks = (value: number): string => value.toFixed(1);

const RULES: BoardRule[] = [
  {
    board: 'passing',
    label: 'Passing',
    primary: 'passing_yards',
    secondary: ['passing_tds'],
    line: (v) => join([`${n(v, 'passing_yards')} pass yds`, tds(n(v, 'passing_tds'))]),
  },
  {
    board: 'rushing',
    label: 'Rushing',
    primary: 'rushing_yards',
    secondary: ['rushing_tds'],
    line: (v) => join([`${n(v, 'rushing_yards')} rush yds`, tds(n(v, 'rushing_tds'))]),
  },
  {
    board: 'receiving',
    label: 'Receiving',
    primary: 'receiving_yards',
    secondary: ['receiving_tds'],
    line: (v) => join([`${n(v, 'receiving_yards')} rec yds`, tds(n(v, 'receiving_tds'))]),
  },
  {
    // The defensive board is ranked by sacks, so that is what this row is,
    // and it says so rather than claiming to be the week's best defender.
    board: 'defense',
    label: 'Sacks',
    primary: 'def_sacks',
    secondary: ['def_interceptions', 'def_qb_hits'],
    line: (v) => join([`${sacks(n(v, 'def_sacks'))} sacks`, plural(n(v, 'def_interceptions'), 'INT')]),
  },
  {
    board: 'kicking',
    label: 'Kicking',
    primary: 'fg_made',
    secondary: ['fg_long'],
    line: (v) => join([`${n(v, 'fg_made')} FG`, n(v, 'fg_long') ? `long ${n(v, 'fg_long')}` : '']),
  },
];

function join(parts: string[]): string {
  return parts.filter(Boolean).join(', ');
}

function tds(count: number): string {
  return count > 0 ? `${count} TD` : '';
}

function plural(count: number, word: string): string {
  if (count <= 0) return '';
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/**
 * Where `value` falls in a pool: the share of team games below it, with
 * equal ones counted as half, so a stat that comes in small steps (sacks,
 * field goals) does not jump from one end of its ties to the other.
 */
export function percentileIn(pool: Pool, value: number): number {
  let below = 0;
  let equal = 0;
  for (const [v, count] of pool.values) {
    if (v < value) below += count;
    else if (v === value) equal += count;
  }
  return (below + equal / 2) / pool.games;
}

/**
 * The week's top `limit` lines across categories, highest percentile first,
 * one per player (their best). A line with nothing in its headline stat is
 * left out. Equal percentiles go to the category listed first, then the
 * secondary stats, then the name, so a build with unchanged data produces
 * an unchanged page.
 */
export function notablePerformances(lines: WeekLine[], pools: Record<string, Pool>, limit = 5): Performance[] {
  const scored: { line: WeekLine; rule: BoardRule; order: number; percentile: number }[] = [];
  RULES.forEach((rule, order) => {
    const pool = pools[rule.board];
    if (!pool || pool.games === 0) return;
    for (const line of lines) {
      if (line.board !== rule.board || n(line.values, rule.primary) <= 0) continue;
      scored.push({ line, rule, order, percentile: percentileIn(pool, n(line.values, rule.primary)) });
    }
  });

  scored.sort(
    (a, b) =>
      b.percentile - a.percentile ||
      a.order - b.order ||
      compare(a.line, b.line, a.rule)
  );

  const out: Performance[] = [];
  const seen = new Set<string>();
  for (const { line, rule, percentile } of scored) {
    if (seen.has(line.playerId)) continue;
    seen.add(line.playerId);
    out.push({
      playerId: line.playerId,
      player: line.player,
      team: line.team,
      opponent: line.opponent,
      home: line.home,
      board: line.board,
      label: rule.label,
      line: `${rule.line(line.values)} ${line.home ? 'vs' : 'at'} ${line.opponent}`,
      percentile,
    });
    if (out.length === limit) break;
  }
  return out;
}

function compare(a: WeekLine, b: WeekLine, rule: BoardRule): number {
  let order = 0;
  for (const key of rule.secondary) {
    if (order !== 0) break;
    order = n(b.values, key) - n(a.values, key);
  }
  return order || a.player.localeCompare(b.player);
}
