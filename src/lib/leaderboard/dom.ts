/**
 * Progressive enhancement for Leaderboard.astro. Without JavaScript the
 * table is complete, ranked by the board's primary column. With it, column
 * headers become sort buttons and the totals / per game switch appears.
 *
 * Values come from the rendered cells' data-v attributes, and sorting
 * moves the existing rows rather than rebuilding them, so the page never
 * carries a second copy of the data.
 */
import {
  arrange,
  capArrangement,
  cellValue,
  defaultDirection,
  formatCell,
  qualifiedOnly,
  type ColumnSpec,
  type Direction,
  type Mode,
  type RowSpec,
} from './arrange';

interface BoardColumn extends ColumnSpec {
  title: string;
}

interface BoardConfig {
  columns: BoardColumn[];
  primary: string;
  qualifierText: string;
  /** Top N only; the page carries each column's top N, not every player */
  limit: number | null;
}

interface LiveRow extends RowSpec {
  tr: HTMLTableRowElement;
  rankCell: HTMLElement;
  cells: Map<string, HTMLElement>;
}

function readRows(tbody: HTMLTableSectionElement): LiveRow[] {
  return [...tbody.rows].map((tr) => {
    const cells = new Map<string, HTMLElement>();
    const values: Record<string, number | null> = {};
    for (const cell of tr.querySelectorAll<HTMLElement>('[data-col]')) {
      const key = cell.dataset.col!;
      cells.set(key, cell);
      values[key] = cell.dataset.v === '' || cell.dataset.v === undefined ? null : Number(cell.dataset.v);
    }
    return {
      tr,
      rankCell: tr.querySelector<HTMLElement>('[data-rank]')!,
      cells,
      values,
      qualified: tr.dataset.qualified === '1',
    };
  });
}

function setUp(root: HTMLElement): void {
  const config = JSON.parse(
    root.querySelector<HTMLScriptElement>('script[data-board-config]')!.textContent!
  ) as BoardConfig;
  const table = root.querySelector('table')!;
  const tbody = table.tBodies[0]!;
  const status = root.querySelector<HTMLElement>('[data-board-status]')!;
  const modeButtons = [...root.querySelectorAll<HTMLButtonElement>('[data-mode]')];
  const rows = readRows(tbody);
  const byKey = new Map(config.columns.map((column) => [column.key, column]));

  let sortKey = config.primary;
  let direction: Direction = defaultDirection(byKey.get(sortKey)!);
  let mode: Mode = 'totals';

  const headers = [...table.querySelectorAll<HTMLTableCellElement>('th[data-sort]')];
  for (const th of headers) {
    const column = byKey.get(th.dataset.sort!)!;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sort-button';
    button.textContent = th.textContent;
    button.setAttribute('aria-label', `Sort by ${column.title}`);
    th.replaceChildren(button);
    button.addEventListener('click', () => {
      // A capped board only holds each column's best, so it cannot show a
      // true bottom N; reversing is for the full list.
      if (sortKey === column.key) {
        if (!config.limit) direction = direction === 'desc' ? 'asc' : 'desc';
      } else {
        sortKey = column.key;
        direction = defaultDirection(column);
      }
      render();
    });
  }

  for (const button of modeButtons) {
    button.addEventListener('click', () => {
      mode = button.dataset.mode as Mode;
      render();
    });
  }

  function render(): void {
    const column = byKey.get(sortKey)!;
    const arranged = arrange(rows, column, direction, mode);
    const { order, ranks, shown } = config.limit ? capArrangement(arranged, config.limit) : arranged;

    const fragment = document.createDocumentFragment();
    for (const index of order) {
      const row = rows[index]!;
      row.tr.hidden = !shown[index];
      row.rankCell.textContent = ranks[index] === null ? '' : String(ranks[index]);
      for (const [key, cell] of row.cells) {
        const spec = byKey.get(key)!;
        if (spec.perGame) cell.textContent = formatCell(cellValue(row, spec, mode), spec, mode);
      }
      fragment.append(row.tr);
    }
    tbody.append(fragment);

    for (const th of headers) {
      if (th.dataset.sort === sortKey) {
        th.setAttribute('aria-sort', direction === 'desc' ? 'descending' : 'ascending');
      } else th.removeAttribute('aria-sort');
    }
    for (const button of modeButtons) {
      button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
    }

    const view = mode === 'perGame' ? 'per game' : 'totals';
    const who = qualifiedOnly(column, mode)
      ? `Qualified players only. ${config.qualifierText}`
      : 'All players.';
    const lead = config.limit ? `Top ${config.limit} by` : 'Sorted by';
    status.textContent = `${lead} ${column.title.toLowerCase()}, ${view}. ${who}`;
  }

  root.querySelector<HTMLElement>('[data-board-controls]')!.hidden = false;
  render();
}

export function initLeaderboards(): void {
  for (const root of document.querySelectorAll<HTMLElement>('[data-leaderboard]')) setUp(root);
}
