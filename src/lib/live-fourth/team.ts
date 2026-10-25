/**
 * A team page's live 4th downs: the live feed (feed.ts) given only this
 * team's game, so one summary is read on load and again when that game's
 * last play changes. Shown once today's game has kicked off: a 4th down of
 * the team's waiting for the snap first, then every one so far, newest
 * first, as items (item.ts), the same as the home panel and the live page.
 * The model starts while the game is live.
 */
import { LIVE_FOURTH_PAGE_ENABLED } from '../../config.ts';
import { siteNow } from '../../utils/now.ts';
import { createFeed, startedToday, type FeedGame, type FeedState } from './feed.ts';
import { entryItem, entryOrder, pendingItem } from './item.ts';
import { createModel } from './model.ts';

function setUp(root: HTMLElement): void {
  const team = root.dataset.teamLive!;
  let games: Record<string, FeedGame> = {};
  try {
    games = JSON.parse(root.querySelector('#live-fourth-games')?.textContent ?? '{}');
  } catch {
    return;
  }
  if (startedToday(games, siteNow()).length === 0) return;
  root.hidden = false;

  const list = root.querySelector<HTMLOListElement>('[data-team-live-list]')!;
  const status = root.querySelector<HTMLElement>('[data-team-live-status]')!;
  let state: FeedState | null = null;

  const model = createModel(render);
  const feed = createFeed(games, (s) => {
    state = s;
    render();
  });

  function render(): void {
    if (state?.anyLive) model.start();
    const offense = (homeBall: boolean, g: FeedGame) => (homeBall ? g.home : g.away);
    const mine = (state?.entries ?? [])
      .filter((e) => offense(e.play.teamId === e.homeId, e.game) === team)
      .sort((a, b) => entryOrder(b) - entryOrder(a));
    const pending = (state?.pending ?? []).filter((p) => offense(p.down.before.possession === p.down.before.homeId, p.game) === team);
    list.replaceChildren(...pending.map((p) => pendingItem(p, model)), ...mine.map((e) => entryItem(e, model)));
    const s = state;
    status.textContent = !s || s.loaded === 0 ? "Reading today's game…" : mine.length + pending.length === 0 ? `No ${team} 4th downs yet.` : '';
    status.hidden = status.textContent === '';
  }

  feed.start();
}

export function initTeamLive(): void {
  if (!LIVE_FOURTH_PAGE_ENABLED) return;
  document.querySelectorAll<HTMLElement>('[data-team-live]').forEach(setUp);
}
