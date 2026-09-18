/**
 * Progressive enhancement for Wire.astro. Without JavaScript the whole
 * wire is listed. With it, the team menu, category buttons and starters
 * switch appear, rows hide and show in place, and the filter is kept in
 * the URL so it survives a reload and can be shared.
 */
import { countByCategory, matches, parseFilter, serializeFilter, type WireFilter, type WireRowSpec } from './filter';

interface LiveRow extends WireRowSpec {
  tr: HTMLTableRowElement;
}

function setUp(root: HTMLElement): void {
  const rows: LiveRow[] = [...root.querySelectorAll<HTMLTableRowElement>('tbody tr')].map((tr) => ({
    tr,
    team: tr.dataset.team!,
    fromTeam: tr.dataset.fromTeam || null,
    category: tr.dataset.category!,
    starter: tr.dataset.starter === '1',
  }));
  const teamSelect = root.querySelector<HTMLSelectElement>('[data-wire-team]')!;
  const starters = root.querySelector<HTMLInputElement>('[data-wire-starters]')!;
  const buttons = [...root.querySelectorAll<HTMLButtonElement>('[data-wire-category]')];
  const status = root.querySelector<HTMLElement>('[data-wire-status]')!;
  const empty = root.querySelector<HTMLElement>('[data-wire-empty]')!;

  const teams = new Set([...teamSelect.options].map((option) => option.value).filter(Boolean));
  const categories = new Set(buttons.map((button) => button.dataset.wireCategory!).filter(Boolean));
  let filter: WireFilter = parseFilter(window.location.search, teams, categories);

  function render(): void {
    let shown = 0;
    for (const row of rows) {
      row.tr.hidden = !matches(row, filter);
      if (!row.tr.hidden) shown += 1;
    }
    empty.hidden = shown > 0;

    const counts = countByCategory(rows, filter);
    const total = [...counts.values()].reduce((sum, n) => sum + n, 0);
    for (const button of buttons) {
      const key = button.dataset.wireCategory || null;
      const n = key ? (counts.get(key) ?? 0) : total;
      button.querySelector('[data-count]')!.textContent = String(n);
      button.setAttribute('aria-pressed', String(key === filter.category));
      // Empty categories drop out, unless they are the one selected.
      button.hidden = key !== null && n === 0 && key !== filter.category;
    }

    teamSelect.value = filter.team ?? '';
    starters.checked = filter.startersOnly;
    status.textContent = `Showing ${shown} of ${rows.length}.`;
    const query = serializeFilter(filter);
    if (query !== window.location.search) {
      history.replaceState(null, '', `${window.location.pathname}${query}`);
    }
  }

  teamSelect.addEventListener('change', () => {
    filter = { ...filter, team: teamSelect.value || null };
    render();
  });
  starters.addEventListener('change', () => {
    filter = { ...filter, startersOnly: starters.checked };
    render();
  });
  for (const button of buttons) {
    button.addEventListener('click', () => {
      filter = { ...filter, category: button.dataset.wireCategory || null };
      render();
    });
  }

  root.querySelector<HTMLElement>('[data-wire-controls]')!.hidden = false;
  render();
}

export function initWires(): void {
  for (const root of document.querySelectorAll<HTMLElement>('[data-wire]')) setUp(root);
}
