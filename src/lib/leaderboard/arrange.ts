/**
 * Sorting and the totals / per game switch for leaderboard tables. Pure
 * functions over plain values so they run under Node's test runner; the
 * DOM wiring is in dom.ts.
 */

export type Mode = 'totals' | 'perGame';
export type Direction = 'asc' | 'desc';

export interface ColumnSpec {
  key: string;
  format: 'integer' | 'decimal1' | 'percent1';
  perGame: boolean;
  rate: boolean;
  better: 'high' | 'low';
}

export interface RowSpec {
  values: Record<string, number | null>;
  qualified: boolean;
}

/** The number a cell shows in a view: per game divides counting stats by games played. */
export function cellValue(row: RowSpec, column: ColumnSpec, mode: Mode): number | null {
  const value = row.values[column.key];
  if (value === null || value === undefined) return null;
  if (mode === 'perGame' && column.perGame) {
    const games = row.values.games;
    return games ? value / games : null;
  }
  return value;
}

export function formatCell(value: number | null, column: ColumnSpec, mode: Mode): string {
  if (value === null) return '-';
  if (column.format === 'percent1') return `${(value * 100).toFixed(1)}%`;
  if (column.format === 'decimal1' || (mode === 'perGame' && column.perGame)) {
    return value.toFixed(1);
  }
  return String(value);
}

/**
 * Rate columns and the per game view rank qualified players only, so a
 * 1 for 1 passer never leads completion percentage.
 */
export function qualifiedOnly(column: ColumnSpec, mode: Mode): boolean {
  return column.rate || mode === 'perGame';
}

export function defaultDirection(column: ColumnSpec): Direction {
  return column.better === 'high' ? 'desc' : 'asc';
}

export interface Arrangement {
  /** Row indexes in display order: shown rows first, then hidden ones */
  order: number[];
  /** Rank per row index; null for hidden rows */
  ranks: (number | null)[];
  /** Whether each row index is shown */
  shown: boolean[];
}

/**
 * Order rows by a column. Empty values sort last in either direction,
 * ties keep the incoming order (the board's default rank), and players
 * showing the same number share a rank.
 */
export function arrange(
  rows: RowSpec[],
  column: ColumnSpec,
  direction: Direction,
  mode: Mode
): Arrangement {
  const onlyQualified = qualifiedOnly(column, mode);
  const shown = rows.map((row) => !onlyQualified || row.qualified);
  const values = rows.map((row) => cellValue(row, column, mode));
  const sign = direction === 'desc' ? -1 : 1;

  const visible = rows.map((_, i) => i).filter((i) => shown[i]);
  visible.sort((a, b) => {
    const va = values[a]!;
    const vb = values[b]!;
    if (va === null || vb === null) return (va === null ? 1 : 0) - (vb === null ? 1 : 0) || a - b;
    return sign * (va - vb) || a - b;
  });

  const ranks: (number | null)[] = rows.map(() => null);
  let previous: string | null = null;
  visible.forEach((index, position) => {
    const shownText = formatCell(values[index]!, column, mode);
    const prior = position > 0 ? visible[position - 1]! : null;
    ranks[index] = prior !== null && shownText === previous ? ranks[prior]! : position + 1;
    previous = shownText;
  });

  const hidden = rows.map((_, i) => i).filter((i) => !shown[i]);
  return { order: [...visible, ...hidden], ranks, shown };
}

const MODES: Mode[] = ['totals', 'perGame'];

/**
 * Rows a capped board must carry so that sorting by any column, in either
 * view, still shows the true top `limit`: the union of each column's top
 * `limit` in its default direction. Returned in the incoming order.
 */
export function rowsForTopN(rows: RowSpec[], columns: ColumnSpec[], limit: number): number[] {
  const keep = new Set<number>();
  for (const column of columns) {
    for (const mode of MODES) {
      const { order, shown } = arrange(rows, column, defaultDirection(column), mode);
      for (const index of order.filter((i) => shown[i]).slice(0, limit)) keep.add(index);
    }
  }
  return [...keep].sort((a, b) => a - b);
}

/** Cap an arrangement to its first `limit` shown rows. */
export function capArrangement(arrangement: Arrangement, limit: number): Arrangement {
  let count = 0;
  const shown = arrangement.shown.map(() => false);
  for (const index of arrangement.order) {
    if (arrangement.shown[index] && count < limit) {
      shown[index] = true;
      count += 1;
    }
  }
  return { ...arrangement, shown, ranks: arrangement.ranks.map((rank, i) => (shown[i] ? rank : null)) };
}
