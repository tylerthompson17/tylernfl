/**
 * The target map's rules: which cells are shaded and how strongly, the
 * summary beside the grid, and the words for a receiver's grid and a
 * passer's.
 *
 * A cell is compared with the league's EPA per target in the same cell over
 * the season before (leagueEpaPerTarget, from the pipeline): a deep pass is
 * worth far more than a screen, so one midpoint for every cell would
 * describe the zone, not the player. Cells under SHADE_MIN_TARGETS are
 * unshaded with muted text and show no EPA, and cells under
 * FULL_SHADE_MIN_TARGETS get the lighter shade at most, since rates on small
 * samples mislead.
 */
import type { TargetCell, TargetDepth, TargetGrid, TargetLocation } from '../../data/types';

export const SHADE_MIN_TARGETS = 5;
export const FULL_SHADE_MIN_TARGETS = 10;
/** EPA per target above or below the league at which each step starts. */
export const SHADE_STEPS = [0.15, 0.5] as const;

export type Shade = 'sparse' | 'none' | 'neutral' | `${'win' | 'loss'}-${1 | 2}`;

type Comparable = Pick<TargetCell, 'targets' | 'epaPerTarget' | 'leagueEpaPerTarget'>;

/** EPA per target minus the league's in the same cell, or null when either
 * is missing or the cell is too small to say. Both inputs are rounded to 3
 * places; the difference is too, so 0.15 is 0.15. */
export function vsLeague(cell: Comparable): number | null {
  if (cell.targets < SHADE_MIN_TARGETS || cell.epaPerTarget === null || cell.leagueEpaPerTarget === null) {
    return null;
  }
  return Math.round((cell.epaPerTarget - cell.leagueEpaPerTarget) * 1000) / 1000;
}

export function shadeOf(cell: Comparable): Shade {
  if (cell.targets < SHADE_MIN_TARGETS) return 'sparse';
  const diff = vsLeague(cell);
  if (diff === null) return 'none';
  const reached = SHADE_STEPS.filter((edge) => Math.abs(diff) >= edge).length;
  const step = Math.min(reached, cell.targets < FULL_SHADE_MIN_TARGETS ? 1 : 2) as 0 | 1 | 2;
  if (step === 0) return 'neutral';
  return `${diff > 0 ? 'win' : 'loss'}-${step}`;
}

/** Worst to best, as the legend reads. */
export const LEGEND_SHADES: Shade[] = ['loss-2', 'loss-1', 'neutral', 'win-1', 'win-2'];

export const LOCATIONS: { location: TargetLocation; label: string }[] = [
  { location: 'left', label: 'Left' },
  { location: 'middle', label: 'Middle' },
  { location: 'right', label: 'Right' },
];

/** Top to bottom, as the field is drawn: deep at the top. */
export const DEPTHS: { depth: TargetDepth; label: string; range: string }[] = [
  { depth: 'deep', label: 'Deep', range: '20+' },
  { depth: 'intermediate', label: 'Intermediate', range: '10 to 19' },
  { depth: 'short', label: 'Short', range: '0 to 9' },
  { depth: 'behind', label: 'Behind', range: 'Under 0' },
];

/** Sideline labels at the band edges, in yards past the line, with how
 * many bands up from the bottom each edge is. */
export const SIDE_LABELS = [
  { text: '+20', bands: 3 },
  { text: '+10', bands: 2 },
];

/** Passers' grids with fewer throws than this are not shown at all. */
export const MIN_THROWS = 3;

/** The grid's cells as rows, deep first, left to right. */
export function cellRows(grid: TargetGrid): { depth: (typeof DEPTHS)[number]; cells: TargetCell[] }[] {
  return DEPTHS.map((depth) => ({
    depth,
    cells: LOCATIONS.map(
      ({ location }) => grid.cells.find((c) => c.location === location && c.depth === depth.depth)!
    ),
  }));
}

/**
 * The zones furthest above and below the league, among cells big enough to
 * compare. Ties go to the cell with more targets. With one such cell it is
 * the best and there is no worst; with none, neither.
 */
export function bestAndWorst(grid: TargetGrid): { best: TargetCell | null; worst: TargetCell | null } {
  const ranked = grid.cells
    .filter((c) => vsLeague(c) !== null)
    .sort((a, b) => vsLeague(b)! - vsLeague(a)! || b.targets - a.targets);
  if (ranked.length === 0) return { best: null, worst: null };
  if (ranked.length === 1) return { best: ranked[0]!, worst: null };
  const worst = [...ranked].sort((a, b) => vsLeague(a)! - vsLeague(b)! || b.targets - a.targets)[0]!;
  return { best: ranked[0]!, worst };
}

/** Each depth band's targets and share of the player's total, deep first,
 * beside the league's share (null without one). */
export function depthShares(
  grid: TargetGrid,
  league: Record<TargetDepth, number> | null
): { depth: (typeof DEPTHS)[number]; targets: number; share: number | null; league: number | null }[] {
  const total = grid.total.targets;
  return DEPTHS.map((depth) => {
    const targets = grid.cells.filter((c) => c.depth === depth.depth).reduce((sum, c) => sum + c.targets, 0);
    return { depth, targets, share: total ? targets / total : null, league: league ? league[depth.depth] : null };
  });
}

export type TargetKind = 'targets' | 'throws';

export const WORDS = {
  targets: {
    title: 'Target locations',
    noun: ['target', 'targets'],
    caught: 'Rec',
    rate: 'Catch %',
    rateWord: 'catch',
    plays: 'Tgt',
    dpi: "Defensive pass interference isn't counted as a target.",
  },
  throws: {
    title: 'Throw locations',
    noun: ['throw', 'throws'],
    caught: 'Cmp',
    rate: 'Comp %',
    rateWord: 'comp',
    plays: 'Att',
    dpi: "Defensive pass interference, throwaways and spikes aren't counted as throws.",
  },
} as const;

export const zoneName = (cell: Pick<TargetCell, 'location' | 'depth'>) => {
  const depth = DEPTHS.find((d) => d.depth === cell.depth)!;
  const where = cell.depth === 'behind' ? 'Behind the line' : depth.label;
  return `${where}, ${cell.location}`;
};

export const count = (n: number, kind: TargetKind) => `${n} ${WORDS[kind].noun[n === 1 ? 0 : 1]}`;

export const wholePercent = (rate: number | null) => (rate === null ? '-' : `${Math.round(rate * 100)}%`);

/** A difference from the league to two places, with a true minus sign. */
export const signed2 = (value: number) => {
  const fixed = Math.abs(value).toFixed(2);
  if (Number(fixed) === 0) return fixed;
  return `${value > 0 ? '+' : '−'}${fixed}`;
};
