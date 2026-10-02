/**
 * The target map's rules: which cells are shaded and how strongly, and
 * the words for a receiver's grid and a passer's.
 *
 * A cell is shaded by its EPA per target against the league's in the same
 * cell over the season before (leagueEpaPerTarget, from the pipeline): a
 * deep pass is worth far more than a screen, so one midpoint for every cell
 * would describe the zone, not the player. Cells under SHADE_MIN_TARGETS
 * are gray instead, since a rate on one or two targets misleads.
 */
import type { TargetCell, TargetDepth, TargetGrid, TargetLocation } from '../../data/types';

export const SHADE_MIN_TARGETS = 3;
/** EPA per target above or below the league at which each step starts. */
export const SHADE_STEPS = [0.15, 0.4, 0.8] as const;

export type Shade = 'sparse' | 'none' | 'neutral' | `${'win' | 'loss'}-${1 | 2 | 3}`;

export function shadeOf(cell: Pick<TargetCell, 'targets' | 'epaPerTarget' | 'leagueEpaPerTarget'>): Shade {
  if (cell.targets < SHADE_MIN_TARGETS) return 'sparse';
  if (cell.epaPerTarget === null || cell.leagueEpaPerTarget === null) return 'none';
  // Both are rounded to 3 places; round the difference too, so 0.15 is 0.15.
  const diff = Math.round((cell.epaPerTarget - cell.leagueEpaPerTarget) * 1000) / 1000;
  const step = SHADE_STEPS.filter((edge) => Math.abs(diff) >= edge).length as 0 | 1 | 2 | 3;
  if (step === 0) return 'neutral';
  return `${diff > 0 ? 'win' : 'loss'}-${step}`;
}

export const LOCATIONS: { location: TargetLocation; label: string }[] = [
  { location: 'left', label: 'Left' },
  { location: 'middle', label: 'Middle' },
  { location: 'right', label: 'Right' },
];

/** Top to bottom, as the field is drawn: deep at the top. */
export const DEPTHS: { depth: TargetDepth; label: string; range: string }[] = [
  { depth: 'deep', label: 'Deep', range: '20+ yds' },
  { depth: 'intermediate', label: 'Intermediate', range: '10 to 19' },
  { depth: 'short', label: 'Short', range: '0 to 9' },
  { depth: 'behind', label: 'Behind', range: 'Under 0' },
];

/** The grid's cells as rows, deep first, left to right. */
export function cellRows(grid: TargetGrid): { depth: (typeof DEPTHS)[number]; cells: TargetCell[] }[] {
  return DEPTHS.map((depth) => ({
    depth,
    cells: LOCATIONS.map(
      ({ location }) => grid.cells.find((c) => c.location === location && c.depth === depth.depth)!
    ),
  }));
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

export const wholePercent = (rate: number | null) => (rate === null ? '' : `${Math.round(rate * 100)}%`);
