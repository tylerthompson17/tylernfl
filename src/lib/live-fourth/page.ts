/**
 * /fourth-down/live/: every 4th down of today's games, newest first, from
 * ESPN's summaries (feed.ts), as items (item.ts): game and clock, the
 * situation, what happened, the verdict against nfl4th and every option's
 * win probability. A 4th down waiting for the snap comes first. The model
 * loads with the page. Two tabs on one URL (?tab=questionable), switched in
 * place so the summaries and the model are not fetched again. Grades are
 * preliminary; the final ones are on /decisions/.
 */
import { createFeed, type FeedEntry, type FeedGame, type FeedState } from './feed.ts';
import { entryGrade, entryItem, entryOrder, pendingItem } from './item.ts';
import { createModel } from './model.ts';

type Tab = 'all' | 'questionable';

function setUp(root: HTMLElement): void {
  let games: Record<string, FeedGame> = {};
  try {
    games = JSON.parse(document.getElementById('live-fourth-games')?.textContent ?? '{}');
  } catch {
    return;
  }
  const list = root.querySelector<HTMLOListElement>('[data-live-rows]')!;
  const empty = root.querySelector<HTMLElement>('[data-live-empty]')!;
  const status = root.querySelector<HTMLElement>('[data-live-status]')!;
  const tabs = [...root.querySelectorAll<HTMLAnchorElement>('[data-tab]')];

  let tab: Tab = new URLSearchParams(window.location.search).get('tab') === 'questionable' ? 'questionable' : 'all';
  let state: FeedState | null = null;

  const model = createModel(render);
  const feed = createFeed(games, (s) => {
    state = s;
    render();
  });

  /** Questionable calls, most WP lost first, once the model has graded them. */
  function questionable(entries: FeedEntry[]): FeedEntry[] {
    const lost = new Map<FeedEntry, number>();
    for (const e of entries) {
      const g = entryGrade(e, model);
      if (g?.kind === 'graded' && g.questionable) lost.set(e, g.wpLost ?? 0);
    }
    return [...lost.keys()].sort((a, b) => lost.get(b)! - lost.get(a)! || entryOrder(b) - entryOrder(a));
  }

  function render(): void {
    for (const a of tabs) a.setAttribute('aria-current', String(a.dataset.tab === tab ? 'page' : 'false'));
    const all = [...(state?.entries ?? [])].sort((a, b) => entryOrder(b) - entryOrder(a));
    const items =
      tab === 'all'
        ? [...(state?.pending ?? []).map((p) => pendingItem(p, model)), ...all.map((e) => entryItem(e, model))]
        : questionable(all).map((e) => entryItem(e, model));
    list.replaceChildren(...items);
    list.hidden = items.length === 0;
    empty.hidden = items.length > 0;

    const s = state;
    if (!s || s.started === 0) {
      status.textContent = 'No games have kicked off today yet. This page fills in from the first 4th down.';
      empty.textContent = 'No 4th downs yet today.';
      return;
    }
    const left = s.started - s.loaded;
    const loading = left > 0 ? ` Loading ${left} more ${left === 1 ? 'game' : 'games'}.` : '';
    const failed = s.failed
      ? ` ${s.failed} ${s.failed === 1 ? "game's play-by-play" : "games' play-by-play"} could not be read; it is retried on the next play.`
      : '';
    status.textContent =
      `${all.length} 4th ${all.length === 1 ? 'down' : 'downs'} from ${s.loaded} of today's ${s.started} ` +
      `${s.started === 1 ? 'game' : 'games'}${s.anyLive ? ', updating as plays are reported' : ''}.${loading}${failed}`;
    empty.textContent =
      tab === 'questionable'
        ? model.state() === 'ready'
          ? 'No questionable calls yet today.'
          : "Questionable calls appear once nfl4th's numbers are in."
        : 'No 4th downs yet today.';
  }

  for (const a of tabs) {
    a.addEventListener('click', (event) => {
      event.preventDefault();
      tab = a.dataset.tab === 'questionable' ? 'questionable' : 'all';
      history.replaceState(null, '', `${window.location.pathname}${tab === 'questionable' ? '?tab=questionable' : ''}`);
      render();
    });
  }

  model.start();
  feed.start();
  render();
}

export function initLivePage(): void {
  document.querySelectorAll<HTMLElement>('[data-live-page]').forEach(setUp);
}
