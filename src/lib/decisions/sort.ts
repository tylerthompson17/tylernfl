/**
 * Sorting for the coaches table on /decisions/. Without JavaScript it is
 * complete, ranked by WP lost as the pipeline ranked it. With it, the
 * number columns' headers become sort buttons; rows move rather than being
 * rebuilt, and coaches showing the same number share a rank (arrange(),
 * the stats boards' rule).
 */
import { arrange, defaultDirection, type ColumnSpec, type Direction, type RowSpec } from '../leaderboard/arrange';

interface CoachRow extends RowSpec {
  tr: HTMLTableRowElement;
  rankCell: HTMLElement;
}

function setUp(root: HTMLElement): void {
  const columns = JSON.parse(root.querySelector<HTMLScriptElement>('script[data-sort-config]')!.textContent!) as (ColumnSpec & {
    title: string;
  })[];
  const byKey = new Map(columns.map((c) => [c.key, c]));
  const table = root.querySelector('table')!;
  const tbody = table.tBodies[0]!;
  const status = root.querySelector<HTMLElement>('[data-sort-status]');
  const rows: CoachRow[] = [...tbody.rows].map((tr) => {
    const values: Record<string, number | null> = {};
    for (const cell of tr.querySelectorAll<HTMLElement>('[data-col]')) values[cell.dataset.col!] = Number(cell.dataset.v);
    return { tr, rankCell: tr.querySelector<HTMLElement>('[data-rank]')!, values, qualified: true };
  });

  const headers = [...table.querySelectorAll<HTMLTableCellElement>('th[data-sort]')];
  let sortKey = headers.find((th) => th.hasAttribute('aria-sort'))?.dataset.sort ?? columns[0].key;
  let direction: Direction = 'desc';

  function render(): void {
    const column = byKey.get(sortKey)!;
    const { order, ranks } = arrange(rows, column, direction, 'totals');
    const fragment = document.createDocumentFragment();
    for (const i of order) {
      rows[i].rankCell.textContent = String(ranks[i]);
      fragment.append(rows[i].tr);
    }
    tbody.append(fragment);
    for (const th of headers) {
      if (th.dataset.sort === sortKey) th.setAttribute('aria-sort', direction === 'desc' ? 'descending' : 'ascending');
      else th.removeAttribute('aria-sort');
    }
    if (status) status.textContent = `Sorted by ${column.title.toLowerCase()}, ${direction === 'desc' ? 'most' : 'fewest'} first.`;
  }

  for (const th of headers) {
    const column = byKey.get(th.dataset.sort!)!;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sort-button';
    button.textContent = th.textContent;
    button.setAttribute('aria-label', `Sort by ${column.title}`);
    if (th.title) button.title = th.title;
    th.replaceChildren(button);
    button.addEventListener('click', () => {
      if (sortKey === column.key) direction = direction === 'desc' ? 'asc' : 'desc';
      else {
        sortKey = column.key;
        direction = defaultDirection(column);
      }
      render();
    });
  }
}

export function initCoachSort(): void {
  document.querySelectorAll<HTMLElement>('[data-coach-table]').forEach(setUp);
}
