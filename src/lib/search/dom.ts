/**
 * The header search box: a combobox over the build-time index. The index
 * (search-index.js, built with the site) loads the first time the box is
 * focused or typed in. Arrow keys move through results, Enter opens one,
 * Escape closes the list, and "/" anywhere on the page focuses the box.
 */
import { search, type SearchEntry } from './match';

const LIMIT = 8;

export function initSearch(): void {
  const input = document.querySelector<HTMLInputElement>('[data-search-input]');
  const list = document.querySelector<HTMLUListElement>('[data-search-results]');
  const status = document.querySelector<HTMLElement>('[data-search-status]');
  if (!input || !list || !status) return;

  let entries: SearchEntry[] | null = null;
  let loading: Promise<void> | null = null;
  let results: SearchEntry[] = [];
  let active = -1;

  const load = (): Promise<void> => {
    loading ??= import(/* @vite-ignore */ input.dataset.index!)
      .then((module: { default: SearchEntry[] }) => {
        entries = module.default;
      })
      .catch(() => {
        loading = null;
        status.textContent = 'Search is unavailable right now.';
      });
    return loading;
  };

  function close(): void {
    list!.hidden = true;
    input!.setAttribute('aria-expanded', 'false');
    input!.removeAttribute('aria-activedescendant');
    active = -1;
  }

  function highlight(index: number): void {
    active = index;
    [...list!.children].forEach((li, i) => li.setAttribute('aria-selected', String(i === index)));
    if (index >= 0) input!.setAttribute('aria-activedescendant', `search-option-${index}`);
    else input!.removeAttribute('aria-activedescendant');
  }

  function render(): void {
    const typed = input!.value;
    if (!entries || !typed.trim()) {
      list!.replaceChildren();
      status!.textContent = '';
      close();
      return;
    }
    results = search(entries, typed, LIMIT);
    list!.replaceChildren(
      ...results.map((entry, i) => {
        const li = document.createElement('li');
        li.id = `search-option-${i}`;
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', 'false');
        li.dataset.kind = entry.kind;
        const label = document.createElement('span');
        label.className = 'search-label';
        label.textContent = entry.label;
        const detail = document.createElement('span');
        detail.className = 'search-detail';
        detail.textContent = entry.detail;
        li.append(label, detail);
        // mousedown, not click, so the input's blur does not close the list first.
        li.addEventListener('mousedown', (event) => {
          event.preventDefault();
          window.location.href = entry.href;
        });
        li.addEventListener('mousemove', () => highlight(i));
        return li;
      })
    );
    if (results.length === 0) {
      const li = document.createElement('li');
      li.className = 'search-empty';
      li.textContent = 'No players, teams or pages match.';
      list!.append(li);
    }
    list!.hidden = false;
    input!.setAttribute('aria-expanded', 'true');
    highlight(results.length > 0 ? 0 : -1);
    status!.textContent =
      results.length === 0 ? 'No results.' : `${results.length} results. Use up and down arrows to choose.`;
  }

  input.addEventListener('focus', () => void load());
  input.addEventListener('input', () => void load().then(render));
  input.addEventListener('blur', close);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (!list.hidden) close();
      else input.value = '';
      return;
    }
    if (list.hidden || results.length === 0) {
      if (event.key === 'ArrowDown' && input.value.trim()) void load().then(render);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      highlight((active + step + results.length) % results.length);
    } else if (event.key === 'Enter' && active >= 0) {
      event.preventDefault();
      window.location.href = results[active]!.href;
    }
  });

  document.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement;
    const typing = target.closest('input, textarea, select, [contenteditable="true"]');
    if (event.key === '/' && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      input.focus();
    }
  });

  input.disabled = false;
}
