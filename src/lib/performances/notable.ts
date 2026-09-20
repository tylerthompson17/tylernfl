/**
 * The week's notable player performances, picked from game logs.
 *
 * Selection is deliberately separated from the shape it produces. Today's
 * rule is one row per category: the week's leader in each board's headline
 * stat, kept only if it clears a bar. A later rule can rank performances
 * against each other across categories instead, which needs a way to score
 * a 400 yard passing day against a three sack day. That is modelling and
 * belongs to Tyler; when it exists it should return this same
 * `Performance[]` and the panel will not change.
 *
 * The bars below are this site's editorial choice, like the leaderboard
 * qualifiers in pipelines/leaderboards.py. They are the round numbers the
 * sport already treats as milestones, not anything derived.
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
}

interface BoardRule {
  board: string;
  label: string;
  /** Ranked by this column, and measured against the bar by it. */
  primary: string;
  /** Ties go to the higher value here, in order. What the line shows first. */
  secondary: string[];
  bar: number;
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
    bar: 300,
    line: (v) => join([`${n(v, 'passing_yards')} pass yds`, tds(n(v, 'passing_tds'))]),
  },
  {
    board: 'rushing',
    label: 'Rushing',
    primary: 'rushing_yards',
    secondary: ['rushing_tds'],
    bar: 100,
    line: (v) => join([`${n(v, 'rushing_yards')} rush yds`, tds(n(v, 'rushing_tds'))]),
  },
  {
    board: 'receiving',
    label: 'Receiving',
    primary: 'receiving_yards',
    secondary: ['receiving_tds'],
    bar: 100,
    line: (v) => join([`${n(v, 'receiving_yards')} rec yds`, tds(n(v, 'receiving_tds'))]),
  },
  {
    // The defensive board is ranked by sacks, so that is what this row is,
    // and it says so rather than claiming to be the week's best defender.
    board: 'defense',
    label: 'Sacks',
    primary: 'def_sacks',
    secondary: ['def_interceptions', 'def_qb_hits'],
    bar: 2,
    line: (v) => join([`${sacks(n(v, 'def_sacks'))} sacks`, plural(n(v, 'def_interceptions'), 'INT')]),
  },
  {
    board: 'kicking',
    label: 'Kicking',
    primary: 'fg_made',
    secondary: ['fg_long'],
    bar: 4,
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
 * The best line on each board that clears its bar, in the order the rules
 * are listed. Ties go to the secondary stats in turn, then to the name, so
 * a build with unchanged data produces an unchanged page.
 */
export function notablePerformances(lines: WeekLine[]): Performance[] {
  const out: Performance[] = [];

  for (const rule of RULES) {
    let best: WeekLine | null = null;
    for (const line of lines) {
      if (line.board !== rule.board || n(line.values, rule.primary) < rule.bar) continue;
      if (!best || compare(line, best, rule) < 0) best = line;
    }
    if (!best) continue;
    out.push({
      playerId: best.playerId,
      player: best.player,
      team: best.team,
      opponent: best.opponent,
      home: best.home,
      board: best.board,
      label: rule.label,
      line: `${rule.line(best.values)} ${best.home ? 'vs' : 'at'} ${best.opponent}`,
    });
  }

  return out;
}

function compare(a: WeekLine, b: WeekLine, rule: BoardRule): number {
  let order = n(b.values, rule.primary) - n(a.values, rule.primary);
  for (const key of rule.secondary) {
    if (order !== 0) break;
    order = n(b.values, key) - n(a.values, key);
  }
  return order || a.player.localeCompare(b.player);
}
