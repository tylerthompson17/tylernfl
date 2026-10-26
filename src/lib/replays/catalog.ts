/**
 * The /replays/ list of every highlight. Without JavaScript the table is
 * complete, biggest win probability swing first. With it: filter by team
 * and play type, sort by date, swing or type from the column headers, and
 * pick plays (kept in this browser only) to copy their keys, for choosing
 * which ones get a replay built. Rows move rather than being rebuilt.
 */

export type SortKey = 'date' | 'swing' | 'type' | 'speed' | 'air';
export type Direction = 'asc' | 'desc';

export interface CatalogRow {
  key: string;
  date: string;
  teams: string[];
  type: string;
  /** Points of the offense's win probability gained (negative: lost), null without both numbers */
  swing: number | null;
  /** The carrier's top speed (mph) and the pass's air yards, from tracking; the dev catalog shows them */
  speed?: number | null;
  air?: number | null;
  /** Position in the page as built, for stable ties */
  order: number;
}

export const TYPE_LABELS: Record<string, string> = {
  pass: 'Pass',
  rush: 'Run',
  sack: 'Sack',
  punt: 'Punt',
  kickoff: 'Kickoff',
  two_point_conversion: 'Two point try',
};

export const typeLabel = (type: string) => TYPE_LABELS[type] ?? type;

export const playCount = (n: number) => `${n} ${n === 1 ? 'play' : 'plays'}`;

/** Points of win probability, one decimal. */
export function swingOf(before: number | null, after: number | null): number | null {
  if (before === null || after === null) return null;
  return Math.round((after - before) * 1000) / 10;
}

export function matches(row: CatalogRow, team: string, type: string): boolean {
  return (!team || row.teams.includes(team)) && (!type || row.type === type);
}

/**
 * Rows in order. Swing sorts by size whichever way it went, so the biggest
 * moments come first either way; a row without a number sorts last in
 * both directions. Ties keep the built order.
 */
export function sortRows(rows: CatalogRow[], key: SortKey, direction: Direction): CatalogRow[] {
  const sign = direction === 'desc' ? -1 : 1;
  const value = (r: CatalogRow): string | number | null => {
    if (key === 'swing') return r.swing === null ? null : Math.abs(r.swing);
    if (key === 'speed') return r.speed ?? null;
    if (key === 'air') return r.air ?? null;
    return key === 'date' ? r.date || null : typeLabel(r.type);
  };
  return [...rows].sort((a, b) => {
    const va = value(a), vb = value(b);
    if (va === null || vb === null) return va === vb ? a.order - b.order : va === null ? 1 : -1;
    if (va < vb) return -sign;
    if (va > vb) return sign;
    return a.order - b.order;
  });
}

const PICKS_KEY = 'tylernfl-replay-picks';

function loadPicks(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(PICKS_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

function savePicks(picks: Set<string>): void {
  try {
    localStorage.setItem(PICKS_KEY, JSON.stringify([...picks]));
  } catch {
    // Picks still work for this visit without storage.
  }
}

const SORT_WORDS: Record<SortKey, [string, string]> = {
  date: ['newest first', 'oldest first'],
  swing: ['biggest swing first', 'smallest swing first'],
  type: ['play type, Z to A', 'play type, A to Z'],
  speed: ['fastest carrier first', 'slowest carrier first'],
  air: ['deepest pass first', 'shortest pass first'],
};

export function initCatalog(root: HTMLElement): void {
  const table = root.querySelector('table');
  const tbody = table?.tBodies[0];
  if (!table || !tbody) return;
  const teamSelect = root.querySelector<HTMLSelectElement>('[data-team]');
  const typeButtons = [...root.querySelectorAll<HTMLButtonElement>('button[data-type]')];
  const pickedOnly = root.querySelector<HTMLInputElement>('[data-picked-only]');
  const status = root.querySelector<HTMLElement>('[data-status]');
  const sortStatus = root.querySelector<HTMLElement>('[data-sort-status]');
  const pickCount = root.querySelector<HTMLElement>('[data-pick-count]');
  const copy = root.querySelector<HTMLButtonElement>('[data-copy]');
  const copyStatus = root.querySelector<HTMLElement>('[data-copy-status]');
  const clear = root.querySelector<HTMLButtonElement>('[data-clear]');

  const trs = [...tbody.rows];
  const rows: CatalogRow[] = trs.map((tr, order) => ({
    key: tr.dataset.key!,
    date: tr.dataset.date ?? '',
    teams: (tr.dataset.teams ?? '').split(' ').filter(Boolean),
    type: tr.dataset.playType ?? '',
    swing: tr.dataset.swing ? Number(tr.dataset.swing) : null,
    speed: tr.dataset.speed ? Number(tr.dataset.speed) : null,
    air: tr.dataset.air ? Number(tr.dataset.air) : null,
    order,
  }));
  const trOf = new Map(rows.map((r, i) => [r.key, trs[i]!]));
  const picks = loadPicks();
  let team = '';
  let type = '';
  let sortKey: SortKey = 'swing';
  let direction: Direction = 'desc';

  const headers = [...table.querySelectorAll<HTMLTableCellElement>('th[data-sort]')];
  for (const th of headers) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sort-button';
    button.textContent = th.textContent;
    th.replaceChildren(button);
    button.addEventListener('click', () => {
      const key = th.dataset.sort as SortKey;
      if (key === sortKey) direction = direction === 'desc' ? 'asc' : 'desc';
      else {
        sortKey = key;
        direction = key === 'type' ? 'asc' : 'desc';
      }
      update();
    });
  }

  function updatePicks() {
    const n = picks.size;
    if (pickCount) pickCount.textContent = `${n} picked`;
    if (copy) copy.disabled = n === 0;
    if (clear) clear.disabled = n === 0;
    savePicks(picks);
  }

  function update() {
    const fragment = document.createDocumentFragment();
    let shown = 0;
    for (const row of sortRows(rows, sortKey, direction)) {
      const tr = trOf.get(row.key)!;
      const visible = matches(row, team, type) && (!pickedOnly?.checked || picks.has(row.key));
      tr.hidden = !visible;
      if (visible) shown++;
      fragment.append(tr);
    }
    tbody!.append(fragment);
    for (const th of headers) {
      if (th.dataset.sort === sortKey) th.setAttribute('aria-sort', direction === 'desc' ? 'descending' : 'ascending');
      else th.removeAttribute('aria-sort');
    }
    for (const button of typeButtons) button.setAttribute('aria-pressed', String(button.dataset.type === type));
    if (status) status.textContent = shown === rows.length ? `${playCount(rows.length)}.` : `${shown} of ${playCount(rows.length)}.`;
    if (sortStatus) sortStatus.textContent = `Sorted ${SORT_WORDS[sortKey][direction === 'desc' ? 0 : 1]}.`;
  }

  for (const box of root.querySelectorAll<HTMLInputElement>('[data-pick]')) {
    box.disabled = false;
    box.checked = picks.has(box.value);
    box.addEventListener('change', () => {
      if (box.checked) picks.add(box.value);
      else picks.delete(box.value);
      updatePicks();
      if (pickedOnly?.checked) update();
    });
  }
  teamSelect?.addEventListener('change', () => {
    team = teamSelect.value;
    update();
  });
  for (const button of typeButtons) {
    button.addEventListener('click', () => {
      type = button.dataset.type ?? '';
      update();
    });
  }
  pickedOnly?.addEventListener('change', update);
  copy?.addEventListener('click', async () => {
    const keys = rows.map((r) => r.key).filter((k) => picks.has(k)).join('\n');
    try {
      await navigator.clipboard.writeText(keys);
      if (copyStatus) copyStatus.textContent = `Copied ${picks.size} ${picks.size === 1 ? 'key' : 'keys'}.`;
    } catch {
      if (copyStatus) copyStatus.textContent = `Could not copy. Picked: ${keys.split('\n').join(', ')}`;
    }
  });
  clear?.addEventListener('click', () => {
    picks.clear();
    for (const box of root.querySelectorAll<HTMLInputElement>('[data-pick]')) box.checked = false;
    updatePicks();
    update();
  });

  root.querySelector('[data-controls]')?.removeAttribute('hidden');
  updatePicks();
  update();
}
