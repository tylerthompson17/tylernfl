/**
 * The daily 4th down game's page script. The plays, their reveals and the
 * score table are already on the page; this shows one play at a time,
 * records each pick, fills the score, the share text and the visitor's
 * history, and keeps all of it in localStorage (every access wrapped, so a
 * private window or blocked storage still plays, just without memory).
 */
import type { FourthDownCall } from '../fourth-down';
import { siteNow } from '../../utils/now';
import {
  callWords,
  dateWords,
  parseStore,
  pickLine,
  picksFor,
  points,
  scoreLine,
  scoreOf,
  shareText,
  streaks,
  withPick,
  wpLost,
  type ScoredGame,
  type Store,
} from './game';

const KEY = 'tylernfl.daily-fourth';

type Embedded = ScoredGame & { link: string };

function load(): Store {
  try {
    return parseStore(localStorage.getItem(KEY));
  } catch {
    return parseStore(null);
  }
}

function save(store: Store): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    // Storage blocked or full: the game still plays, it just is not remembered.
  }
}

const easternDate = (d: Date): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

export function initDailyFourth(): void {
  const root = document.querySelector<HTMLElement>('[data-daily]');
  const data = document.getElementById('daily-fourth');
  if (!root || !data?.textContent) return;
  const game = JSON.parse(data.textContent) as Embedded;
  const plays = [...root.querySelectorAll<HTMLElement>('[data-play]')];
  const progress = root.querySelector<HTMLElement>('[data-progress]')!;
  const namesButton = root.querySelector<HTMLButtonElement>('[data-names]')!;
  let store = load();

  // A build is made each morning; a page older than today's Eastern date says so.
  if (easternDate(siteNow()) > game.date) root.querySelector<HTMLElement>('[data-stale]')!.hidden = false;

  const showNames = (on: boolean) => {
    root.classList.toggle('names', on);
    namesButton.setAttribute('aria-pressed', String(on));
    namesButton.textContent = on ? 'Hide teams' : 'Show teams';
  };
  showNames(store.names);
  namesButton.addEventListener('click', () => {
    store = { ...load(), names: !root.classList.contains('names') };
    save(store);
    showNames(store.names);
  });

  /** Mark a play as answered: the pick, the reveal, no more choices. */
  const answer = (i: number, pick: FourthDownCall) => {
    const el = plays[i];
    for (const b of el.querySelectorAll<HTMLButtonElement>('[data-pick]')) {
      b.disabled = true;
      b.setAttribute('aria-pressed', String(b.dataset.pick === pick));
    }
    el.querySelector<HTMLElement>('[data-you]')!.textContent = pickLine(game.plays[i], pick);
    const who = el.querySelector<HTMLElement>(`[data-who="${CSS.escape(pick)}"]`);
    if (who) who.textContent = ['You', who.textContent].filter(Boolean).join(', ');
    el.querySelector<HTMLElement>('[data-reveal]')!.hidden = false;
    el.querySelector<HTMLElement>('[data-waiting]')!.hidden = true;
  };

  const calls = (n: number) => (progress.textContent = `Calls made: ${n} of ${plays.length}`);

  const show = (i: number) => {
    plays.forEach((el, j) => (el.hidden = j !== i));
  };

  const finish = (picks: FourthDownCall[]) => {
    plays.forEach((el) => (el.hidden = false));
    for (const b of root.querySelectorAll<HTMLElement>('[data-next]')) b.hidden = true;
    const s = scoreOf(game.plays, picks);
    root.querySelector<HTMLElement>('[data-score-line]')!.textContent = scoreLine(s, plays.length);
    picks.forEach((pick, i) => {
      const row = root.querySelector<HTMLElement>(`[data-summary="${i}"]`)!;
      row.querySelector<HTMLElement>('[data-summary-pick]')!.textContent = callWords(pick);
      row.querySelector<HTMLElement>('[data-summary-lost]')!.textContent = points(wpLost(game.plays[i], pick));
    });
    root.querySelector<HTMLTextAreaElement>('[data-share]')!.value = shareText(game, picks, game.link);
    root.querySelector<HTMLElement>('[data-score]')!.hidden = false;
    root.querySelector<HTMLElement>('[data-score-empty]')!.hidden = true;
  };

  const history = () => {
    const { current, best, played } = streaks(store, game.number);
    if (played === 0) return;
    root.querySelector<HTMLElement>('[data-streak]')!.textContent =
      `Current streak: ${current} ${current === 1 ? 'day' : 'days'}. Best: ${best}. Games played: ${played}.`;
    const rows = root.querySelector<HTMLElement>('[data-history-rows]')!;
    rows.replaceChildren(
      ...[...store.days].reverse().slice(0, 14).map((d) => {
        const tr = document.createElement('tr');
        for (const [text, num] of [
          [String(d.number), true],
          [dateWords(d.date), false],
          [points(d.wpLost), true],
          [points(d.coachWpLost), true],
        ] as const) {
          const td = document.createElement('td');
          td.textContent = text;
          if (num) td.className = 'number';
          tr.append(td);
        }
        return tr;
      }),
    );
    root.querySelector<HTMLElement>('[data-history]')!.hidden = false;
  };

  // Pick up where the visitor left off: answered plays revealed, the next one shown.
  const picks = picksFor(store, game);
  picks.forEach((pick, i) => answer(i, pick));
  calls(picks.length);
  if (picks.length >= plays.length) finish(picks);
  else show(picks.length);
  history();

  plays.forEach((el, i) => {
    for (const b of el.querySelectorAll<HTMLButtonElement>('[data-pick]')) {
      b.addEventListener('click', () => {
        if (picksFor(store, game).length !== i) return;
        store = withPick(load(), game, b.dataset.pick as FourthDownCall);
        save(store);
        answer(i, b.dataset.pick as FourthDownCall);
        calls(i + 1);
        el.querySelector<HTMLElement>('[data-you]')!.focus();
      });
    }
    el.querySelector<HTMLButtonElement>('[data-next]')!.addEventListener('click', () => {
      if (i + 1 < plays.length) {
        show(i + 1);
        plays[i + 1].querySelector<HTMLButtonElement>('[data-pick]')?.focus();
      } else {
        finish(picksFor(store, game));
        history();
        root.querySelector<HTMLElement>('[data-score-line]')!.scrollIntoView({ block: 'center' });
      }
    });
  });

  root.querySelector<HTMLButtonElement>('[data-copy]')!.addEventListener('click', async () => {
    const text = root.querySelector<HTMLTextAreaElement>('[data-share]')!;
    const status = root.querySelector<HTMLElement>('[data-copied]')!;
    try {
      await navigator.clipboard.writeText(text.value);
      status.textContent = 'Copied.';
    } catch {
      text.select();
      status.textContent = 'Selected: copy it with your keyboard.';
    }
  });
}
