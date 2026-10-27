/**
 * One replay's controls and the HTML around its canvas: play and pause,
 * restart, speed, the scrubber, the stats, routes and debug toggles, and,
 * kept in step with the frame, the scorebug (score, running clock, the
 * win probability swing at the last frame), the caption and the stat
 * labels. The win probability counts from its before value to its after
 * value as the ball goes (wpProgress), and a play that ends the game goes
 * Final. Moments get effects (effects.ts) and sounds (sound.ts, off until
 * the sound button turns it on). A replay starts by itself once most of it
 * is on screen (the site's no motion rule has this exception), never under
 * reduced motion, which also gets no effects; playback pauses when the tab
 * is hidden. Phones get a tighter framing and start with stats off. On a
 * replay page the scene is embedded at build time; the home page's panel
 * passes one it loaded (src/lib/replays/home.ts) and tears the player down
 * with the returned function before showing another.
 */
import type { ReplayScene } from '../../data/types.ts';
import {
  CAPTION_WORDS,
  captionEventAt,
  carrierAt,
  clockAtFrame,
  effectsOf,
  endsGame,
  FAST_MPH,
  firstDownFrame,
  interceptor,
  nearMisses,
  mph,
  prepare,
  sample,
  scoreAt,
  separationAt,
  speedTagPlayer,
  throwMarkOpacity,
  throwOf,
  wpAt,
  wpProgress,
  type EffectKind,
} from './timeline.ts';
import { FRAMINGS, PHONE_MAX_WIDTH, ReplayRenderer, readColors } from './render.ts';
import { ReplayFx, type FxTeam, type Spot } from './effects.ts';
import { onSoundChange, playSound, setSound, soundOn } from './sound.ts';
import { shortName, wpShownAt } from './words.ts';

const ORDINAL = ['1st', '2nd', '3rd', '4th'];
/** Pixels from a sprite's feet to just over its helmet */
const HEAD_PX = 23;
/** Share of the replay (or of the window, when it is taller) that has to be on screen before it starts by itself */
const AUTOPLAY_SHARE = 0.6;

/** A hit on a carrier going this fast (mph) is a BOOM */
const BOOM_MPH = 14;
/** Playback rate during a slow motion moment, and how long each lasts (ms of real time) */
const SLOW_RATE = 0.3;
const SLOW_PICK_MS = 900;
const SLOW_MISS_MS = 350;

const WORDS: Partial<Record<EffectKind, string>> = {
  interception: 'INTERCEPTION!',
  fumble: 'FUMBLE!',
  sack: 'SACK!',
  blocked: 'BLOCKED!',
  touchdown: 'TOUCHDOWN!',
  safety: 'SAFETY!',
};

export interface ReplayStart {
  /** The scene to play; without it, the one embedded in `root` */
  scene?: ReplayScene;
  /** Frame to show first, or the last one; otherwise `data-start`, else 0 */
  start?: number | 'end';
  /** Called each time playback reaches the last frame (src/lib/replays/intro.ts waits on it) */
  onEnd?: () => void;
  /** Start playing once most of the replay is on screen (never under reduced motion) */
  autoplay?: boolean;
  /** False leaves the touchdown and FINAL words and confetti to the caller (the intro has its own) */
  celebrate?: boolean;
}

/** Start a player in `root`; the returned function stops it and removes every listener it added. */
export function initReplay(root: HTMLElement, given: ReplayStart = {}): () => void {
  const q = <T extends Element>(selector: string) => root.querySelector<T>(selector);
  const data = q<HTMLScriptElement>('[data-scene]');
  const canvas = q<HTMLCanvasElement>('[data-canvas]');
  const play = q<HTMLButtonElement>('[data-play]');
  const restart = q<HTMLButtonElement>('[data-restart]');
  const scrub = q<HTMLInputElement>('[data-scrub]');
  const time = q<HTMLElement>('[data-time]');
  if (!(given.scene || data) || !canvas || !play || !restart || !scrub || !time) return () => {};
  const speeds = [...root.querySelectorAll<HTMLButtonElement>('[data-speed]')];
  const toggles = [...root.querySelectorAll<HTMLButtonElement>('[data-toggle]')];
  const listening = new AbortController();
  const { signal } = listening;

  const scene = given.scene ?? (JSON.parse(data!.textContent ?? '') as ReplayScene);
  const prep = prepare(scene);
  const colors = readColors(root);
  const phone = window.matchMedia(`(max-width: ${PHONE_MAX_WIDTH}px)`);
  const makeRenderer = () => new ReplayRenderer(canvas, prep, colors, phone.matches ? FRAMINGS.phone : FRAMINGS.wide);
  let renderer = makeRenderer();
  const last = prep.frames - 1;
  const total = (last / prep.hz).toFixed(1);
  const thrown = throwOf(prep);
  const penalty = root.dataset.penalty ?? null;
  const progress = wpProgress(prep);
  const final = endsGame(prep);
  const moments = effectsOf(scene);
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const celebrate = given.celebrate ?? true;
  const fxCanvas = q<HTMLCanvasElement>('[data-fx]');
  const fx = fxCanvas && !still ? new ReplayFx(fxCanvas, [canvas, fxCanvas]) : null;
  const featured = scene.teams.featured;
  const after = scene.play.scoreAfter ?? scene.play.scoreBefore;
  const featuredSide = scene.play.home === scene.play.featured ? 'home' : 'away';
  const featuredWon = after[featuredSide] > after[featuredSide === 'home' ? 'away' : 'home'];
  const teamOf = (i: number): FxTeam => (prep.players[i]?.side === 'opponent' ? scene.teams.opponent : featured);
  const picked = interceptor(prep);
  const misses = nearMisses(prep);
  const firstDown = firstDownFrame(prep);
  /** Until when (performance.now) playback runs in slow motion */
  let slowUntil = 0;

  const ui = {
    away: q<HTMLElement>('[data-score="away"]'),
    home: q<HTMLElement>('[data-score="home"]'),
    clock: q<HTMLElement>('[data-clock]'),
    wp: q<HTMLElement>('[data-wp]'),
    meter: q<HTMLElement>('[data-wp-meter]'),
    swing: q<HTMLElement>('[data-swing]'),
    sound: q<HTMLButtonElement>('[data-sound]'),
    caption: q<HTMLElement>('[data-caption]'),
    speed: q<HTMLElement>('[data-tag="speed"]'),
    air: q<HTMLElement>('[data-tag="air"]'),
    separation: q<HTMLElement>('[data-tag="separation"]'),
    carrier: q<HTMLElement>('[data-tag="carrier"]'),
  };

  const start = given.start ?? Number(root.dataset.start ?? 0);
  let frame = start === 'end' ? last : Math.min(Math.max(start, 0), last);
  let playing = false;
  let speed = 1;
  let previous = 0;
  /** The fast sound plays once a run */
  let fastHeard = false;
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

  /** Set a score, with a pop when it changes during playback. */
  function setScore(el: HTMLElement | null, value: number) {
    if (!el || el.textContent === String(value)) return;
    el.textContent = String(value);
    if (playing && fx) el.animate([{ transform: 'scale(1.6)' }, { transform: 'none' }], { duration: 450, easing: 'ease-out' });
  }

  function updatePage(f: number) {
    const score = scoreAt(scene, f);
    setScore(ui.away, score.away);
    setScore(ui.home, score.home);
    const done = f >= last;
    if (ui.clock) {
      const period = ORDINAL[scene.play.quarter - 1] ?? 'OT';
      ui.clock.textContent = final && done ? (scene.play.quarter >= 5 ? 'Final/OT' : 'Final') : `${period} ${clockAtFrame(prep, f)}`;
      ui.clock.classList.toggle('final', final && done);
    }
    const wp = wpAt(prep, progress, f);
    if (wp !== null) {
      if (ui.wp) ui.wp.textContent = wpShownAt(scene.play, wp);
      if (ui.meter) ui.meter.style.width = `${(wp * 100).toFixed(1)}%`;
    }
    if (ui.swing) {
      ui.swing.classList.toggle('in', done);
      ui.swing.setAttribute('aria-hidden', String(!done));
    }

    // Over the last second, a penalty on the play takes the caption (it is
    // part of the win probability swing), unless a touchdown holds it.
    const event = captionEventAt(scene, f);
    const kind = event === 'pass_outcome_touchdown' ? 'touchdown' : event;
    const flag = kind !== 'touchdown' && penalty && f >= last - prep.hz ? penalty : null;
    if (ui.caption) {
      ui.caption.hidden = event === null && flag === null;
      ui.caption.textContent = flag ?? (event ? CAPTION_WORDS[event]! : '');
      ui.caption.dataset.kind = flag ? 'penalty' : (kind ?? '');
    }

    placed = ui.caption && !ui.caption.hidden ? [ui.caption.getBoundingClientRect()] : [];
    // Who has the ball, under his feet, whether or not stats are on.
    const holder = carrierAt(prep, f);
    const carrier = holder === null ? null : prep.players[holder];
    const cx = carrier ? sample(carrier.x, f) : null;
    const cy = carrier ? sample(carrier.y, f) : null;
    if (carrier && carrier.name && cx !== null && cy !== null) {
      const at = renderer.project(cx, cy);
      place(ui.carrier, shortName(carrier.name), at.x, at.y + 4, 1, true);
    } else place(ui.carrier, null);

    // A fast carrier: speed lines behind him, and the speed tag marked.
    const carrierMph = carrier ? mph(sample(carrier.speed, f) ?? 0) : 0;
    const fast = carrier !== null && cx !== null && cy !== null && carrierMph >= FAST_MPH;
    if (fx) {
      const bx = carrier ? sample(carrier.x, f - 1) : null;
      const by = carrier ? sample(carrier.y, f - 1) : null;
      if (fast && playing && bx !== null && by !== null) {
        const a = renderer.project(bx, by);
        const b = renderer.project(cx!, cy!);
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        fx.speed(len > 0 ? { x: b.x, y: b.y, dx: (b.x - a.x) / len, dy: (b.y - a.y) / len } : null);
      } else fx.speed(null);
    }
    if (fast && playing && !fastHeard) {
      fastHeard = true;
      playSound('fast');
    }
    if (ui.speed) ui.speed.dataset.fast = String(fast);
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

  /** Canvas point of the ball at a frame */
  function ballAt(f: number) {
    const i = Math.min(Math.max(Math.round(f), 0), last);
    return renderer.project(prep.ball.x[i]!, prep.ball.y[i]!);
  }

  /** Where a player is at the frame on screen now, for effects that follow him */
  const spot = (i: number): Spot => () => {
    const p = prep.players[i];
    const x = p ? sample(p.x, frame) : null;
    const y = p ? sample(p.y, frame) : null;
    return x === null || y === null ? null : renderer.project(x, y);
  };

  function slow(ms: number) {
    if (fx) slowUntil = Math.max(slowUntil, performance.now() + ms);
  }

  /** A moment's effect and sound, as playback passes it */
  function moment(kind: EffectKind, f: number) {
    const holder = carrierAt(prep, f);
    const hard = kind === 'hit' && holder !== null && mph(sample(prep.players[holder]!.speed, f) ?? 0) >= BOOM_MPH;
    playSound(hard ? 'boom' : kind);
    if (!fx) return;
    if (kind === 'interception' && picked) {
      fx.spotlight(spot(picked.player), teamOf(picked.player));
      slow(SLOW_PICK_MS);
    }
    if (hard) {
      fx.pop('BOOM!', spot(holder!), teamOf(holder!), 0.9);
      fx.shake(3, 260);
    }
    const word = WORDS[kind];
    if (kind === 'touchdown' || kind === 'safety') {
      if (!celebrate) return;
      fx.flash();
      fx.confetti(featured);
    }
    if (word) fx.slam(word, featured);
    if (kind === 'interception' || kind === 'fumble' || kind === 'blocked') {
      fx.flash();
      fx.shake(5);
    } else if (kind === 'sack') fx.shake(4);
    else if (kind === 'hit') {
      fx.puff(ballAt(f));
      fx.shake(1.5, 200);
    } else if (kind === 'kick') fx.puff(ballAt(f));
    else if (kind === 'catch') fx.burst(ballAt(f));
    else if (kind === 'flag') fx.flag(ballAt(f));
  }

  /** Everything between two frames of playback, and the final whistle at the last */
  function passed(from: number, to: number) {
    const crossed = (f: number) => f > from && f <= to;
    for (const m of moments) if (crossed(m.frame)) moment(m.kind, m.frame);
    for (const m of misses) {
      if (!crossed(m.frame)) continue;
      playSound('juke');
      if (!fx) continue;
      fx.pop('WHIFF!', spot(m.defender), teamOf(m.carrier));
      const at = spot(m.defender)();
      if (at) fx.puff(at);
      slow(SLOW_MISS_MS);
    }
    if (firstDown !== null && crossed(firstDown)) {
      playSound('firstdown');
      const holder = carrierAt(prep, firstDown);
      if (fx && holder !== null) fx.pop('1ST DOWN!', spot(holder), teamOf(holder));
    }
    if (to >= last && from < last && final) {
      playSound('final');
      if (fx && celebrate) {
        fx.slam('FINAL', featured, 2.2);
        if (featuredWon) fx.confetti(featured);
      }
    }
  }

  /** Back to a quiet field: scrubbing, restart */
  function reset() {
    steps.clear();
    fx?.clear();
    fastHeard = false;
    slowUntil = 0;
  }

  function render() {
    renderer.draw(frame, options);
    fx?.size(canvas!.width, canvas!.height);
    updatePage(frame);
    scrub!.value = String(frame);
    time!.textContent = `${(frame / prep.hz).toFixed(1)} s of ${total} s`;
  }

  function setPlaying(on: boolean) {
    if (on && frame >= last) {
      frame = 0;
      reset();
    }
    playing = on;
    if (!on) fx?.speed(null);
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
    const from = frame;
    const rate = now < slowUntil ? SLOW_RATE : 1;
    frame = Math.min(last, frame + dt * prep.hz * speed * rate);
    passed(from, frame);
    render();
    if (frame >= last) {
      setPlaying(false);
      given.onEnd?.();
    } else requestAnimationFrame(tick);
  }

  play.textContent = 'Play';
  play.addEventListener('click', () => setPlaying(!playing), { signal });
  restart.addEventListener(
    'click',
    () => {
      frame = 0;
      reset();
      render();
    },
    { signal },
  );
  scrub.addEventListener(
    'input',
    () => {
      frame = Number(scrub.value);
      reset();
      render();
    },
    { signal },
  );
  for (const button of speeds) {
    button.addEventListener(
      'click',
      () => {
        speed = Number(button.dataset.speed);
        for (const b of speeds) b.setAttribute('aria-pressed', String(b === button));
      },
      { signal },
    );
  }
  for (const button of toggles) {
    button.addEventListener(
      'click',
      () => {
        const key = button.dataset.toggle as keyof typeof options;
        options[key] = !options[key];
        button.setAttribute('aria-pressed', String(options[key]));
        render();
      },
      { signal },
    );
  }
  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.hidden && playing) setPlaying(false);
    },
    { signal },
  );
  // Crossing the phone width changes the framing; the stats toggle stays as the visitor left it.
  phone.addEventListener(
    'change',
    () => {
      renderer = makeRenderer();
      render();
    },
    { signal },
  );
  // Labels sit in CSS pixels, so they move when the canvas is resized.
  const resized = new ResizeObserver(() => updatePage(frame));
  resized.observe(canvas);

  // The sound button: one setting for every replay on the site.
  const showSound = (on: boolean) => {
    if (!ui.sound) return;
    ui.sound.setAttribute('aria-pressed', String(on));
    ui.sound.title = on ? 'Sound on' : 'Sound off';
  };
  let unsound = () => {};
  if (ui.sound) {
    ui.sound.hidden = false;
    showSound(soundOn());
    ui.sound.addEventListener('click', () => setSound(!soundOn()), { signal });
    unsound = onSoundChange(showSound);
  }

  // Start by itself the first time most of it is on screen, with the tab in front.
  let inView = false;
  let started = !given.autoplay || still;
  const autostart = () => {
    if (started || !inView || document.hidden) return;
    started = true;
    if (!playing && frame < last) setPlaying(true);
  };
  const seen = new IntersectionObserver(
    (entries) => {
      // Most of the replay, or most of a window too short to hold it.
      inView = entries.some(
        (e) => e.isIntersecting && e.intersectionRect.height >= AUTOPLAY_SHARE * Math.min(e.boundingClientRect.height, innerHeight),
      );
      autostart();
      if (started) seen.disconnect();
    },
    { threshold: [0, 0.2, 0.4, 0.6, 0.8, 1] },
  );
  if (!started) {
    seen.observe(canvas);
    document.addEventListener('visibilitychange', autostart, { signal });
  }
  // Pressing anything first means the visitor is driving.
  for (const el of [play, restart, scrub]) {
    for (const type of ['pointerdown', 'keydown']) el.addEventListener(type, () => (started = true), { signal });
  }

  render();
  return () => {
    playing = false;
    listening.abort();
    resized.disconnect();
    seen.disconnect();
    unsound();
    fx?.stop();
  };
}
