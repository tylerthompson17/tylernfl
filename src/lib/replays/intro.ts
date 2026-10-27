/**
 * The way in from Tyler's portfolio (tylerthompson17.github.io links a
 * replay with ?intro=retro). Its pixel transition ends on plain turf, so
 * the page opens under a turf cover (ReplayPlayer's inline script sets
 * INTRO_CLASS before the page paints). The cover fades to the replay
 * filling the screen, which plays by itself; a beat after the last frame it
 * shrinks into its place in the panel and the controls take over. The
 * visitor clicked to watch this play, so it moves without Play, the second
 * exception to the no motion rule. A touchdown gets a celebration
 * (celebrate.ts) that the shrink waits for. Reduced motion never gets the
 * class; Esc or the skip button shrinks it at once.
 */
import { CELEBRATE_MS, celebrate } from './celebrate.ts';
import { initReplay } from './player.ts';

export const INTRO_CLASS = 'replay-intro';
/** Set on the root element to fade the turf cover out */
export const REVEAL_CLASS = 'replay-intro-reveal';

const COVER_FADE_MS = 700;
const HOLD_LAST_MS = 1100;
const SHRINK_MS = 950;
const EASE = 'cubic-bezier(0.65, 0, 0.35, 1)';

/** The largest 3:2 box that fits the window, centred */
function fullRect() {
  const w = Math.min(window.innerWidth, window.innerHeight * 1.5);
  const h = w / 1.5;
  return { left: (window.innerWidth - w) / 2, top: (window.innerHeight - h) / 2, width: w, height: h };
}

const px = (r: { left: number; top: number; width: number; height: number }) => ({
  left: `${r.left}px`,
  top: `${r.top}px`,
  width: `${r.width}px`,
  height: `${r.height}px`,
});

export function runIntro(root: HTMLElement): void {
  const html = document.documentElement;
  const stage = root.querySelector<HTMLElement>('.stage');
  const playButton = root.querySelector<HTMLButtonElement>('[data-play]');
  if (!stage || !playButton) {
    html.classList.remove(INTRO_CLASS);
    initReplay(root);
    return;
  }
  // A reload or a shared link opens the page as usual.
  const clean = new URL(location.href);
  clean.searchParams.delete('intro');
  history.replaceState(history.state, '', clean);
  window.scrollTo(0, 0);
  html.style.overflow = 'hidden';

  // The stage leaves the panel for the whole window; a placeholder keeps its room.
  const holder = document.createElement('div');
  holder.style.cssText = 'width: 100%; aspect-ratio: 3 / 2;';
  stage.before(holder);
  const backdrop = document.createElement('div');
  backdrop.style.cssText = 'position: fixed; inset: 0; z-index: 998; background: var(--replay-turf-out);';
  document.body.append(backdrop);
  Object.assign(stage.style, { position: 'fixed', zIndex: '999', ...px(fullRect()) });
  const fit = () => Object.assign(stage.style, px(fullRect()));
  window.addEventListener('resize', fit);

  let done = false;
  let holdTimer = 0;
  // Esc or the button skips; a stray click or scroll does not cut the play short.
  const skip = document.createElement('button');
  skip.type = 'button';
  skip.textContent = 'Skip intro (Esc)';
  skip.style.cssText =
    'position: fixed; right: 16px; bottom: 16px; z-index: 1002; padding: 6px 12px; border: 1px solid var(--header-text); background: var(--header); color: var(--header-text); font: 700 13px var(--font-heading); cursor: pointer;';
  document.body.append(skip);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') shrink();
  };

  // A touchdown gets confetti and a big TOUCHDOWN, and the replay waits for it before shrinking.
  const caption = root.querySelector<HTMLElement>('[data-caption]');
  const colors = (root.dataset.teamColors ?? '').split(' ').filter(Boolean);
  let party: ReturnType<typeof celebrate> | null = null;
  let partyAt = 0;
  const watch = new MutationObserver(() => {
    if (done || party || caption?.dataset.kind !== 'touchdown') return;
    const line = [...root.querySelectorAll('.scorebug .team')].map((t) => t.textContent?.trim().replace(/\s+/g, ' ')).join('   ');
    party = celebrate(colors, line);
    partyAt = performance.now();
  });
  if (caption) watch.observe(caption, { attributes: true, attributeFilter: ['data-kind'] });

  function ended() {
    const wait = party ? Math.max(0, CELEBRATE_MS - (performance.now() - partyAt)) : 0;
    holdTimer = window.setTimeout(shrink, Math.max(HOLD_LAST_MS, wait));
  }
  function shrink() {
    if (done) return;
    done = true;
    clearTimeout(holdTimer);
    watch.disconnect();
    window.removeEventListener('resize', fit);
    removeEventListener('keydown', onKey, true);
    skip.remove();
    if (party) {
      const p = party;
      p.canvas.animate([{ opacity: 1 }, { opacity: 0 }], { duration: SHRINK_MS * 0.6, fill: 'forwards' }).finished.then(p.stop);
    }
    html.classList.add(REVEAL_CLASS);
    const from = px(stage!.getBoundingClientRect());
    const to = px(holder.getBoundingClientRect());
    stage!.animate([from, to], { duration: SHRINK_MS, easing: EASE, fill: 'forwards' }).finished.then((a) => {
      a.cancel();
      for (const key of ['position', 'zIndex', 'left', 'top', 'width', 'height'] as const) stage!.style[key] = '';
      holder.remove();
      html.style.overflow = '';
      html.classList.remove(INTRO_CLASS, REVEAL_CLASS);
    });
    backdrop.animate([{ opacity: 1 }, { opacity: 0 }], { duration: SHRINK_MS, easing: EASE }).finished.then(() => backdrop.remove());
  }

  initReplay(root, {
    onEnd: () => {
      if (!done) ended();
    },
  });
  skip.addEventListener('click', shrink);
  addEventListener('keydown', onKey, true);
  // The player pauses while the tab is hidden; coming back picks the intro up where it was.
  document.addEventListener('visibilitychange', () => {
    if (!done && !document.hidden && playButton.textContent === 'Play') playButton.click();
  });
  // A moment on the cover first, so the fade is seen, then the play starts as it clears.
  window.setTimeout(() => html.classList.add(REVEAL_CLASS), 150);
  window.setTimeout(() => {
    if (!done) playButton.click();
  }, 150 + COVER_FADE_MS * 0.6);
}
