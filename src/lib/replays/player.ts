/**
 * One replay's controls and the HTML around its canvas: play and pause,
 * restart, speed, the scrubber, the stats, routes and debug toggles, and,
 * kept in step with the frame, the scorebug (score, running clock, the
 * win probability swing at the last frame), the caption and the stat
 * labels. Nothing moves until the visitor presses play (the site's no
 * motion rule has this one exception), and playback pauses when the tab
 * is hidden. Phones get a tighter framing and start with stats off. The
 * scene is embedded in the page at build time; nothing is fetched.
 */
import type { ReplayScene } from '../../data/types.ts';
import {
  CAPTION_WORDS,
  captionEventAt,
  clockAtFrame,
  mph,
  prepare,
  sample,
  scoreAt,
  separationAt,
  speedTagPlayer,
  throwMarkOpacity,
  throwOf,
} from './timeline.ts';
import { FRAMINGS, PHONE_MAX_WIDTH, ReplayRenderer, readColors } from './render.ts';

const ORDINAL = ['1st', '2nd', '3rd', '4th'];
/** Pixels from a sprite's feet to just over its helmet */
const HEAD_PX = 23;

export function initReplay(root: HTMLElement): void {
  const q = <T extends Element>(selector: string) => root.querySelector<T>(selector);
  const data = q<HTMLScriptElement>('[data-scene]');
  const canvas = q<HTMLCanvasElement>('[data-canvas]');
  const play = q<HTMLButtonElement>('[data-play]');
  const restart = q<HTMLButtonElement>('[data-restart]');
  const scrub = q<HTMLInputElement>('[data-scrub]');
  const time = q<HTMLElement>('[data-time]');
  if (!data || !canvas || !play || !restart || !scrub || !time) return;
  const speeds = [...root.querySelectorAll<HTMLButtonElement>('[data-speed]')];
  const toggles = [...root.querySelectorAll<HTMLButtonElement>('[data-toggle]')];

  const scene = JSON.parse(data.textContent ?? '') as ReplayScene;
  const prep = prepare(scene);
  const colors = readColors(root);
  const phone = window.matchMedia(`(max-width: ${PHONE_MAX_WIDTH}px)`);
  const makeRenderer = () => new ReplayRenderer(canvas, prep, colors, phone.matches ? FRAMINGS.phone : FRAMINGS.wide);
  let renderer = makeRenderer();
  const last = prep.frames - 1;
  const total = (last / prep.hz).toFixed(1);
  const thrown = throwOf(prep);

  const ui = {
    away: q<HTMLElement>('[data-score="away"]'),
    home: q<HTMLElement>('[data-score="home"]'),
    clock: q<HTMLElement>('[data-clock]'),
    swing: q<HTMLElement>('[data-swing]'),
    caption: q<HTMLElement>('[data-caption]'),
    speed: q<HTMLElement>('[data-tag="speed"]'),
    air: q<HTMLElement>('[data-tag="air"]'),
    separation: q<HTMLElement>('[data-tag="separation"]'),
  };

  let frame = Math.min(Math.max(Number(root.dataset.start ?? 0), 0), last);
  let playing = false;
  let speed = 1;
  let previous = 0;
  const options = { trails: false, debug: false, stats: !phone.matches };

  scrub.max = String(last);
  for (const button of toggles) button.setAttribute('aria-pressed', String(options[button.dataset.toggle as keyof typeof options]));
  q('[data-controls]')?.removeAttribute('hidden');

  /** Labels already placed this frame, so a later one can step clear of them. */
  let placed: DOMRect[] = [];
  const overlaps = (a: DOMRect, b: DOMRect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  /**
   * Each shown label's step down from its spot, in canvas pixels: `target`
   * is where it has to be, `shown` where it is drawn. During playback a
   * label keeps its step for as long as it stays up (it never springs back
   * the moment the crowding clears) and steps further only when it would
   * collide. Scrubbing starts the layout afresh.
   */
  const steps = new Map<HTMLElement, { target: number; shown: number }>();
  /** Share of the remaining distance a stepping label covers per drawn frame while playing: about 150 ms at 60 fps */
  const STEP_EASE = 0.3;

  /**
   * Put a label at a canvas point, in CSS pixels over the canvas: its
   * bottom edge there, or with `below` its top edge. A label that would
   * cover one placed before it this frame steps down past it, sliding
   * there during playback. Null text hides it.
   */
  function place(el: HTMLElement | null, text: string | null, x = 0, y = 0, opacity = 1, below = false) {
    if (!el) return;
    el.hidden = text === null || opacity <= 0;
    if (el.hidden) {
      steps.delete(el);
      return;
    }
    const scale = canvas!.clientWidth / canvas!.width;
    el.textContent = text;
    el.style.left = `${x * scale}px`;
    el.style.opacity = String(opacity);
    el.style.transform = below ? 'translate(-50%, 0)' : '';
    const step = steps.get(el) ?? { target: 0, shown: 0 };
    el.style.top = `${(y + step.target) * scale}px`;
    for (let tries = 0; tries < 4; tries++) {
      const rect = el.getBoundingClientRect();
      const hit = placed.find((p) => overlaps(rect, p));
      if (!hit) break;
      step.target += (hit.bottom - rect.top + 2) / scale;
      el.style.top = `${(y + step.target) * scale}px`;
    }
    // Collisions are judged where the label belongs; it is drawn where it has got to.
    placed.push(el.getBoundingClientRect());
    step.shown = playing ? step.shown + (step.target - step.shown) * STEP_EASE : step.target;
    if (Math.abs(step.target - step.shown) < 0.5) step.shown = step.target;
    el.style.top = `${(y + step.shown) * scale}px`;
    steps.set(el, step);
  }

  function updatePage(f: number) {
    const score = scoreAt(scene, f);
    if (ui.away) ui.away.textContent = String(score.away);
    if (ui.home) ui.home.textContent = String(score.home);
    if (ui.clock) ui.clock.textContent = `${ORDINAL[scene.play.quarter - 1] ?? 'OT'} ${clockAtFrame(prep, f)}`;
    if (ui.swing) {
      const done = f >= last;
      ui.swing.classList.toggle('in', done);
      ui.swing.setAttribute('aria-hidden', String(!done));
    }

    const event = captionEventAt(scene, f);
    if (ui.caption) {
      ui.caption.hidden = event === null;
      ui.caption.textContent = event ? CAPTION_WORDS[event]! : '';
      ui.caption.dataset.kind = event ?? '';
    }

    placed = ui.caption && !ui.caption.hidden ? [ui.caption.getBoundingClientRect()] : [];
    if (!options.stats) {
      for (const el of [ui.speed, ui.air, ui.separation]) place(el, null);
      return;
    }
    // The speed of the carrier, or of the receiver while the pass is in the air.
    const who = speedTagPlayer(prep, f, thrown);
    const runner = who === null ? null : prep.players[who];
    const rx = runner ? sample(runner.x, f) : null;
    const ry = runner ? sample(runner.y, f) : null;
    const v = runner ? sample(runner.speed, f) : null;
    if (runner && rx !== null && ry !== null && v !== null && v >= 1) {
      const at = renderer.project(rx, ry);
      place(ui.speed, `${mph(v).toFixed(1)} mph`, at.x, at.y - HEAD_PX);
    } else place(ui.speed, null);

    const opacity = thrown ? throwMarkOpacity(thrown, f, prep.hz) : 0;
    if (thrown && thrown.airYards !== null) {
      const at = renderer.project(thrown.arrival.x, thrown.arrival.y);
      // Under the spot, where the receiver's sprite (which stands up from it) never is.
      place(ui.air, `${thrown.airYards} air yards`, at.x, at.y + 4, opacity, true);
    } else place(ui.air, null);

    // Separation when the ball arrived, for a pass that was caught.
    const gap = thrown && thrown.catchFrame !== null && thrown.receiver !== null && f >= thrown.to
      ? separationAt(prep, thrown.to, thrown.receiver)
      : null;
    if (thrown && gap) {
      const t = thrown.to;
      const r = prep.players[thrown.receiver!]!;
      const d = prep.players[gap.defender]!;
      const at = renderer.project((r.x[t]! + d.x[t]!) / 2, (r.y[t]! + d.y[t]!) / 2);
      place(ui.separation, `${gap.yards.toFixed(1)} yd separation`, at.x, at.y + 16, opacity);
    } else place(ui.separation, null);
  }

  function render() {
    renderer.draw(frame, options);
    updatePage(frame);
    scrub!.value = String(frame);
    time!.textContent = `${(frame / prep.hz).toFixed(1)} s of ${total} s`;
  }

  function setPlaying(on: boolean) {
    if (on && frame >= last) frame = 0;
    playing = on;
    play!.textContent = on ? 'Pause' : 'Play';
    if (on) {
      previous = performance.now();
      requestAnimationFrame(tick);
    }
  }

  function tick(now: number) {
    if (!playing) return;
    const dt = Math.min(0.1, (now - previous) / 1000);
    previous = now;
    frame = Math.min(last, frame + dt * prep.hz * speed);
    render();
    if (frame >= last) setPlaying(false);
    else requestAnimationFrame(tick);
  }

  play.addEventListener('click', () => setPlaying(!playing));
  restart.addEventListener('click', () => {
    frame = 0;
    steps.clear();
    render();
  });
  scrub.addEventListener('input', () => {
    frame = Number(scrub.value);
    steps.clear();
    render();
  });
  for (const button of speeds) {
    button.addEventListener('click', () => {
      speed = Number(button.dataset.speed);
      for (const b of speeds) b.setAttribute('aria-pressed', String(b === button));
    });
  }
  for (const button of toggles) {
    button.addEventListener('click', () => {
      const key = button.dataset.toggle as keyof typeof options;
      options[key] = !options[key];
      button.setAttribute('aria-pressed', String(options[key]));
      render();
    });
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && playing) setPlaying(false);
  });
  // Crossing the phone width changes the framing; the stats toggle stays as the visitor left it.
  phone.addEventListener('change', () => {
    renderer = makeRenderer();
    render();
  });
  // Labels sit in CSS pixels, so they move when the canvas is resized.
  new ResizeObserver(() => updatePage(frame)).observe(canvas);

  render();
}
