/**
 * The home page's live 4th downs panel. The moment the live ticker's poll
 * shows any of today's games live, the one-line calculator link gives way to
 * a "Live 4th downs" panel: any 4th down waiting for the snap first (the
 * only yellow item), then today's 4th downs newest first, three at a time
 * with Previous (newer) and Next (older) buttons, no rotation (item.ts for
 * each item's format). It stays up for the whole game day, between games
 * too, and gives way to the line once every game today is final.
 *
 * Nothing is read until the panel scrolls into view: then the summaries
 * (feed.ts), and, while a game is live, the model, so each item says what
 * nfl4th recommends. With no game live the model stays off.
 */
import { LIVE_FOURTH_DOWN_ENABLED } from '../../config.ts';
import { createFeed, type FeedGame, type FeedState } from './feed.ts';
import { entryItem, entryOrder, pendingItem } from './item.ts';
import { createModel } from './model.ts';
import { pageOf, step } from './paging.ts';

const PAGE = 3;

function setUp(root: HTMLElement): void {
  let games: Record<string, FeedGame> = {};
  try {
    games = JSON.parse(document.getElementById('live-fourth-games')?.textContent ?? '{}');
  } catch {
    return;
  }
  const line = root.querySelector<HTMLElement>('[data-calc-line]')!;
  const panel = root.querySelector<HTMLElement>('[data-live-panel]')!;
  const list = root.querySelector<HTMLOListElement>('[data-live-list]')!;
  const note = root.querySelector<HTMLElement>('[data-live-note]')!;
  const newer = root.querySelector<HTMLButtonElement>('[data-live-newer]')!;
  const older = root.querySelector<HTMLButtonElement>('[data-live-older]')!;
  const position = root.querySelector<HTMLElement>('[data-live-position]')!;
  let state: FeedState | null = null;
  let watching = false;
  let inView = false;
  let shown = false;
  /** First 4th down of the page shown; null for the newest page */
  let anchor: string | null = null;

  const model = createModel(render);
  const feed = createFeed(games, (s) => {
    state = s;
    render();
  });

  const newestFirst = () => [...(state?.entries ?? [])].sort((a, b) => entryOrder(b) - entryOrder(a));

  function render(): void {
    // Up the moment a game is live; down only when the game day is over.
    if (state?.anyLive) shown = true;
    else if (state && !state.gameDay) shown = false;
    panel.hidden = !shown;
    line.hidden = shown;
    if (!shown) return;
    if (!watching) watch();
    // The model only while a game is live and the panel has been seen.
    if (inView && state?.anyLive) model.start();

    const all = newestFirst();
    const ids = all.map((e) => e.play.id);
    const page = pageOf(ids, anchor, PAGE);
    const pending = page.start === 0 ? (state?.pending ?? []) : [];
    list.replaceChildren(
      ...pending.map((p) => pendingItem(p, model)),
      ...all.slice(page.start, page.start + PAGE).map((e) => entryItem(e, model)),
    );
    newer.hidden = older.hidden = position.hidden = ids.length <= PAGE;
    newer.disabled = !page.hasNewer;
    older.disabled = !page.hasOlder;
    position.textContent = page.label;
    const s = state!;
    note.textContent = !inView
      ? ''
      : s.loaded < s.started
        ? `Reading today's games: ${s.loaded} of ${s.started}.`
        : ids.length + pending.length === 0
          ? 'No 4th downs yet today.'
          : '';
    note.hidden = note.textContent === '';
  }

  /** Read the summaries, and start the model while live, once the panel is on screen. */
  function watch(): void {
    watching = true;
    const observer = new IntersectionObserver((seen) => {
      if (seen.some((e) => e.isIntersecting)) {
        observer.disconnect();
        inView = true;
        feed.start();
        render();
      }
    });
    observer.observe(panel);
  }

  const move = (direction: 1 | -1) => {
    const ids = newestFirst().map((e) => e.play.id);
    anchor = step(ids, pageOf(ids, anchor, PAGE), PAGE, direction);
    render();
  };
  older.addEventListener('click', () => move(1));
  newer.addEventListener('click', () => move(-1));
}

export function initLiveFourth(): void {
  // Off: nothing listens, so the home page keeps its one line to the calculator.
  if (!LIVE_FOURTH_DOWN_ENABLED) return;
  document.querySelectorAll<HTMLElement>('[data-live-fourth]').forEach(setUp);
}
