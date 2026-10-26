/**
 * The home page's replay panel (HomeReplay.astro): one of the featured
 * replays at random on each visit, never the one this browser saw last.
 * The page ships only the short list (pick.ts); the chosen scene and the
 * player's code load once the panel is near the screen, and again for
 * "Another play". It never plays by itself: the first frame waits for Play,
 * or the last frame under reduced motion. Every size is set before
 * anything loads, so nothing shifts.
 */
import type { ReplayScene } from '../../data/types.ts';
import { pickReplay, type FeaturedReplay } from './pick.ts';
import { goalToGo, penaltyText, scorebugSituation, wpNumbers, wpSwingReadout } from './words.ts';

const LAST_KEY = 'tylernfl.home-replay';
const ORDINAL = ['1st', '2nd', '3rd', '4th'];

function readLast(): string | null {
  try {
    return localStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
}

function writeLast(key: string): void {
  try {
    localStorage.setItem(LAST_KEY, key);
  } catch {
    // Private windows and blocked storage: the next visit may repeat a play.
  }
}

/**
 * The line over the canvas: score, clock and situation, then the featured
 * team's win probability, as two groups so a narrow panel can give each
 * its own line (HomeReplay.astro).
 */
function fillScoreline(el: HTMLElement, scene: ReplayScene): void {
  const { play } = scene;
  const span = (text: string, className: string) => {
    const s = document.createElement('span');
    s.className = className;
    s.textContent = text;
    return s;
  };
  const score = (abbr: string, value: number, side: 'away' | 'home') => {
    const n = span(String(value), 'num');
    n.dataset.score = side;
    const s = span(`${abbr} `, 'team');
    s.append(n);
    return s;
  };
  const clock = span(`${ORDINAL[play.quarter - 1] ?? 'OT'} ${play.clock.replace(/^0(?=\d:)/, '')}`, 'cell num');
  clock.dataset.clock = '';
  const situation = span(scorebugSituation(play, goalToGo(scene.field)), 'cell');
  const game = span('', 'group');
  game.append(score(play.away, play.scoreBefore.away, 'away'), score(play.home, play.scoreBefore.home, 'home'), clock, situation);
  const parts: HTMLElement[] = [game];
  if (play.wpBefore !== null) {
    const before = play.wpAfter === null ? `${Math.round(play.wpBefore * 100)}%` : wpNumbers(play.wpBefore, play.wpAfter).before;
    const wp = span(`${play.featured} win prob ${before}`, 'cell num');
    const readout = wpSwingReadout(play);
    if (readout) {
      const swing = span(readout, 'swing');
      swing.dataset.swing = '';
      swing.setAttribute('aria-hidden', 'true');
      wp.append(' ', swing);
    }
    const group = span('', 'group');
    group.append(wp);
    parts.push(group);
  }
  el.replaceChildren(...parts);
}

export function initHomeReplay(root: HTMLElement): void {
  const q = <T extends Element>(selector: string) => root.querySelector<T>(selector);
  const list = JSON.parse(q('[data-replay-list]')?.textContent ?? '[]') as FeaturedReplay[];
  const title = q<HTMLElement>('[data-replay-title]');
  const description = q<HTMLElement>('[data-replay-description]');
  const scoreline = q<HTMLElement>('[data-replay-scoreline]');
  const status = q<HTMLElement>('[data-replay-status]');
  const page = q<HTMLAnchorElement>('[data-replay-page]');
  const canvas = q<HTMLCanvasElement>('[data-canvas]');
  const another = q<HTMLButtonElement>('[data-replay-another]');
  const controls = [...root.querySelectorAll<HTMLButtonElement | HTMLInputElement>('[data-play], [data-restart], [data-scrub]')];
  if (list.length === 0 || !title || !description || !scoreline || !status || !page || !another) return;
  const ui = { title, description, scoreline, page };

  const still = window.matchMedia('(prefers-reduced-motion: reduce)');
  const keys = list.map((r) => r.key);
  let current = pickReplay(keys, readLast())!;
  /** Counts loads, so a slow one that a newer pick overtook is dropped. */
  let loads = 0;
  let stop: () => void = () => {};

  const setStatus = (text: string | null) => {
    status.hidden = text === null;
    status.textContent = text ?? '';
  };

  function show(index: number) {
    current = index;
    const replay = list[index]!;
    writeLast(replay.key);
    ui.title.textContent = replay.title;
    ui.description.textContent = replay.description;
    ui.description.title = replay.description;
    ui.page.href = replay.href;
    canvas?.setAttribute('aria-label', `Pixel art replay drawn from player tracking: ${replay.description}`);
  }

  async function load() {
    const replay = list[current]!;
    const mine = ++loads;
    stop();
    stop = () => {};
    for (const c of controls) c.disabled = true;
    setStatus('Loading the replay…');
    try {
      const [player, scene] = await Promise.all([
        import('./player.ts'),
        fetch(replay.scene).then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json() as Promise<ReplayScene>;
        }),
      ]);
      if (mine !== loads) return;
      fillScoreline(ui.scoreline, scene);
      // The player reads the penalty that takes the caption over the last second from here.
      const penalty = penaltyText(scene.play.penalty);
      if (penalty) root.dataset.penalty = penalty;
      else delete root.dataset.penalty;
      setStatus(null);
      for (const c of controls) c.disabled = false;
      stop = player.initReplay(root, { scene, start: still.matches ? 'end' : 0 });
    } catch {
      if (mine !== loads) return;
      ui.scoreline.replaceChildren();
      setStatus("This replay didn't load. It is still on its own page.");
    }
  }

  show(current);
  if (list.length < 2) another.hidden = true;
  // Load once the panel is near the screen (it is at the top, so usually at once).
  const near = new IntersectionObserver(
    (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      near.disconnect();
      void load();
    },
    { rootMargin: '200px' },
  );
  near.observe(root);

  another.addEventListener('click', () => {
    near.disconnect();
    show(pickReplay(keys, list[current]!.key)!);
    void load();
  });
}
