/**
 * Retro Replays effects: pixel art drawn on a canvas laid over the replay at
 * the same resolution, when playback reaches a moment (effectsOf in
 * timeline.ts). A touchdown bursts into confetti in the team's colours and
 * TOUCHDOWN slams in, an interception, fumble or sack slams its word in and
 * shakes the field, the player who picked it off gets a spotlight that
 * follows him, a catch sparks, a hit puffs dust (a big one says BOOM), a
 * missed tackle says WHIFF over the defender, a first down pops over the
 * carrier, a flag flies, a fast carrier trails speed lines, and a play that
 * ends the game stamps FINAL. Effects tied to a player take a function that
 * says where he is now, so they move with him.
 * Effects run on their own clock, so one that starts at the last frame
 * still plays out. Nothing here runs under reduced motion (player.ts never
 * makes one), and scrubbing clears it.
 */
import { textWidth } from './font.ts';
import { bright, shout } from './celebrate.ts';

/** Where a player's feet are on the canvas right now; null when he has no position */
export type Spot = () => { x: number; y: number } | null;

/** A sprite's height in canvas pixels, feet to the top of the helmet */
const SPRITE_PX = 21;

export interface FxTeam {
  primary: string;
  secondary: string;
}

interface Running {
  start: number;
  /** Seconds */
  dur: number;
  draw: (ctx: CanvasRenderingContext2D, t: number) => void;
}

interface Bit {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  phase: number;
}

const WHITE = '#ffffff';
const FLAG = '#f2d22e';
const DUST = '#d8d2bf';

export class ReplayFx {
  private readonly ctx: CanvasRenderingContext2D;
  private running: Running[] = [];
  private streak: { x: number; y: number; dx: number; dy: number } | null = null;
  private raf = 0;
  /** When the last queued word is gone: a word waits for the one before it */
  private wordsFree = 0;
  /** When each small word still up goes, so a new one stacks above them */
  private popsUntil: number[] = [];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    /** What a shake moves: the replay canvas and this one */
    private readonly shaken: HTMLElement[],
  ) {
    this.ctx = canvas.getContext('2d')!;
  }

  /** Match the replay canvas's resolution (it changes with the framing). */
  size(width: number, height: number): void {
    if (this.canvas.width === width && this.canvas.height === height) return;
    this.canvas.width = width;
    this.canvas.height = height;
  }

  /** Remove every effect at once (scrubbing, restart, a new play). */
  clear(): void {
    this.running = [];
    this.streak = null;
    this.wordsFree = 0;
    this.popsUntil = [];
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    for (const el of this.shaken) for (const a of el.getAnimations()) a.cancel();
  }

  /** Speed lines behind a fast carrier at a canvas point, going in a direction (unit vector); null to stop them. */
  speed(at: { x: number; y: number; dx: number; dy: number } | null): void {
    this.streak = at;
    this.wake();
  }

  private add(dur: number, draw: Running['draw'], start = performance.now()) {
    this.running.push({ start, dur, draw });
    this.wake();
  }

  private wake() {
    if (!this.raf) this.raf = requestAnimationFrame((now) => this.frame(now));
  }

  private frame(now: number) {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    this.running = this.running.filter((r) => (now - r.start) / 1000 < r.dur);
    if (this.streak) this.drawStreak(now / 1000);
    for (const r of this.running) if (now >= r.start) r.draw(ctx, (now - r.start) / 1000);
    this.raf = this.running.length || this.streak ? requestAnimationFrame((n) => this.frame(n)) : 0;
  }

  private drawStreak(time: number) {
    const { x, y, dx, dy } = this.streak!;
    const ctx = this.ctx;
    // Lines start behind the sprite's middle, spread across its height, and flicker in length.
    const px = -dy, py = dx;
    // Two pixels thick on the wide framing, one on the phone's smaller canvas.
    const thick = this.canvas.width > 300 ? 2 : 1;
    ctx.fillStyle = WHITE;
    for (let i = 0; i < 5; i++) {
      const offset = (i - 2) * 4;
      const flicker = Math.floor(time * 20 + i * 7) % 3;
      const back = 8 + ((i * 5) % 4) + flicker;
      const length = 10 + ((i * 3) % 9) + flicker * 3;
      const sx = x + px * offset - dx * back;
      const sy = y - 10 + py * offset - dy * back;
      ctx.globalAlpha = 0.6 + 0.15 * flicker;
      for (let s = 0; s < length; s++) ctx.fillRect(Math.round(sx - dx * s), Math.round(sy - dy * s), thick, thick);
    }
    ctx.globalAlpha = 1;
  }

  /** A big pixel word that slams in from twice its size, flashes, holds and fades, after any word still up. */
  slam(word: string, team: FxTeam, dur = 1.7): void {
    const start = Math.max(performance.now(), this.wordsFree);
    this.wordsFree = start + dur * 1000;
    const { width: w, height: h } = this.canvas;
    const big = Math.max(1, Math.min(Math.floor((w * 0.84) / textWidth(word, { scale: 1 })), Math.floor((h * 0.14) / 7)));
    const color = bright(team.secondary);
    this.add(dur, (ctx, t) => {
      const slam = Math.min(1, t / 0.18);
      const scale = Math.max(big, Math.round(big * (2 - slam * slam)));
      const shake = t > 0.18 && t < 0.45 ? Math.round((Math.random() - 0.5) * 2 * Math.max(1, big / 2)) : 0;
      const flash = t < 0.7 && Math.floor(t / 0.1) % 2 === 1;
      ctx.globalAlpha = Math.min(1, (dur - t) / 0.3);
      shout(ctx, word, w / 2 + shake, Math.round(h * 0.4 - (7 * scale) / 2) + shake, scale, flash ? WHITE : color, team.primary);
      ctx.globalAlpha = 1;
    }, start);
  }

  /** Small pixel text: one pixel per font pixel on the phone canvas, two on the wide one */
  private get small(): number {
    return this.canvas.width > 300 ? 2 : 1;
  }

  /** A short word that pops up over a player and rides with him, then fades; above any still up. */
  pop(word: string, where: Spot, team: FxTeam, dur = 1.1): void {
    const scale = this.small;
    const now = performance.now();
    this.popsUntil = this.popsUntil.filter((until) => until > now);
    const lift = this.popsUntil.length * (7 * scale + 3);
    this.popsUntil.push(now + dur * 1000);
    const color = bright(team.secondary);
    let last = where();
    this.add(dur, (ctx, t) => {
      last = where() ?? last;
      if (!last) return;
      // Up fast with a little overshoot, settle, then fade.
      const rise = t < 0.12 ? (t / 0.12) * 1.25 : t < 0.22 ? 1.25 - ((t - 0.12) / 0.1) * 0.25 : 1;
      ctx.globalAlpha = Math.min(1, (dur - t) / 0.25);
      const y = Math.round(last.y - SPRITE_PX - 4 - 7 * scale - rise * 6 * scale - lift);
      shout(ctx, word, last.x, y, scale, t < 0.3 && Math.floor(t / 0.075) % 2 ? WHITE : color, team.primary);
      ctx.globalAlpha = 1;
    });
  }

  /**
   * The player who made the play, picked out: a beam of light from the top
   * of the field onto him, rings pulsing out from under him and glints
   * circling him, moving with him.
   */
  spotlight(where: Spot, team: FxTeam, dur = 2): void {
    const glow = bright(team.secondary);
    let last = where();
    this.add(dur, (ctx, t) => {
      last = where() ?? last;
      if (!last) return;
      const cx = Math.round(last.x), cy = Math.round(last.y);
      const fade = Math.min(1, (dur - t) / 0.4);
      // The beam, in bands of falling brightness so it stays pixel art.
      const open = Math.min(1, t / 0.15);
      for (let band = 0; band < 3; band++) {
        const half = (4 + band * 5) * open;
        ctx.globalAlpha = fade * (0.16 - band * 0.04);
        ctx.fillStyle = WHITE;
        for (let y = 0; y <= cy; y += 2) {
          const w = Math.round(half * (0.35 + 0.65 * (y / Math.max(1, cy))) * 2);
          ctx.fillRect(cx - w / 2, y, w, 2);
        }
      }
      ctx.globalAlpha = fade;
      // Rings on the turf, one every 0.4 s, each widening as it fades.
      const thick = this.small;
      for (let k = 0; k < 2; k++) {
        const u = ((t + k * 0.2) % 0.4) / 0.4;
        const rx = 8 + u * 18, ry = rx * 0.45;
        ctx.fillStyle = k ? glow : WHITE;
        for (let a = 0; a < 48; a++) {
          const th = (a / 48) * Math.PI * 2;
          ctx.fillRect(Math.round(cx + Math.cos(th) * rx), Math.round(cy + Math.sin(th) * ry), thick, thick);
        }
      }
      // Four glints circling at chest height, twinkling.
      for (let i = 0; i < 4; i++) {
        const th = t * 5 + (i / 4) * Math.PI * 2;
        const gx = Math.round(cx + Math.cos(th) * 15);
        const gy = Math.round(cy - SPRITE_PX / 2 + Math.sin(th) * 10);
        const arm = Math.floor(t * 12 + i) % 2 === 0 ? 2 : 1;
        ctx.fillStyle = i % 2 ? glow : WHITE;
        ctx.fillRect(gx - arm, gy, arm * 2 + 1, 1);
        ctx.fillRect(gx, gy - arm, 1, arm * 2 + 1);
      }
      ctx.globalAlpha = 1;
    });
  }

  /** A white flash over the field. */
  flash(dur = 0.2): void {
    const { width: w, height: h } = this.canvas;
    this.add(dur, (ctx, t) => {
      ctx.globalAlpha = 0.6 * (1 - t / dur);
      ctx.fillStyle = WHITE;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
    });
  }

  /** Shake the field, `px` CSS pixels each way. */
  shake(px = 4, ms = 320): void {
    const frames = [0, 1, 2, 3, 4, 5, 6].map((i) => {
      const k = i === 6 ? 0 : px * (1 - i / 6);
      return { transform: `translate(${(i % 2 ? -1 : 1) * k}px, ${(i % 3 === 1 ? 1 : -1) * k * 0.5}px)` };
    });
    for (const el of this.shaken) el.animate(frames, { duration: ms, easing: 'linear' });
  }

  /** Confetti from both bottom corners, then falling, in a team's colours. */
  confetti(team: FxTeam, dur = 2.6): void {
    const { width: w, height: h } = this.canvas;
    const palette = [team.primary, bright(team.secondary), WHITE, team.primary, bright(team.secondary)];
    const pick = () => palette[Math.floor(Math.random() * palette.length)]!;
    const bits: Bit[] = [];
    for (const dir of [1, -1]) {
      for (let i = 0; i < 70; i++) {
        bits.push({ x: dir > 0 ? 0 : w, y: h, vx: dir * w * (0.15 + Math.random() * 0.5), vy: -h * (1 + Math.random() * 0.7), color: pick(), phase: Math.random() * 10 });
      }
    }
    for (let i = 0; i < 60; i++) {
      bits.push({ x: Math.random() * w, y: -Math.random() * h * 0.6, vx: (Math.random() - 0.5) * w * 0.05, vy: h * 0.15, color: pick(), phase: Math.random() * 10 });
    }
    let last = 0;
    this.add(dur, (ctx, t) => {
      const dt = Math.min(0.05, t - last);
      last = t;
      ctx.globalAlpha = Math.min(1, (dur - t) / 0.4);
      for (const b of bits) {
        b.vy = Math.min(b.vy + h * 1.4 * dt, h * 0.25);
        b.vx *= Math.exp(-1.6 * dt);
        b.x += (b.vx + Math.sin(t * 5 + b.phase) * w * 0.02) * dt;
        b.y += b.vy * dt;
        if (b.y < -2 || b.y > h) continue;
        ctx.fillStyle = b.color;
        if (Math.floor(t * 9 + b.phase) % 2) ctx.fillRect(Math.round(b.x), Math.round(b.y), 2, 1);
        else ctx.fillRect(Math.round(b.x), Math.round(b.y), 1, 2);
      }
      ctx.globalAlpha = 1;
    });
  }

  /** A spark of eight rays at a canvas point (a catch). */
  burst(at: { x: number; y: number }, color = WHITE, dur = 0.45): void {
    this.add(dur, (ctx, t) => {
      const u = t / dur;
      ctx.fillStyle = color;
      ctx.globalAlpha = 1 - u;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        for (const r of [4 + u * 10, 6 + u * 12]) ctx.fillRect(Math.round(at.x + Math.cos(a) * r), Math.round(at.y - 12 + Math.sin(a) * r), 1, 1);
      }
      ctx.globalAlpha = 1;
    });
  }

  /** A puff of dust at a canvas point (a hit). */
  puff(at: { x: number; y: number }, dur = 0.4): void {
    const dust = Array.from({ length: 10 }, (_, i) => ({ a: (i / 10) * Math.PI * 2 + Math.random() * 0.4, v: 8 + Math.random() * 8 }));
    this.add(dur, (ctx, t) => {
      const u = t / dur;
      ctx.fillStyle = DUST;
      ctx.globalAlpha = 1 - u;
      for (const d of dust) ctx.fillRect(Math.round(at.x + Math.cos(d.a) * d.v * u), Math.round(at.y - 2 + Math.sin(d.a) * d.v * u * 0.5), 2, 2);
      ctx.globalAlpha = 1;
    });
  }

  /** A yellow flag tossed up from a canvas point, tumbling to the turf. */
  flag(at: { x: number; y: number }, dur = 1.4): void {
    this.add(dur, (ctx, t) => {
      const u = Math.min(1, t / 0.7);
      const x = at.x + 14 * u;
      const y = at.y - 30 * (4 * u * (1 - u));
      ctx.fillStyle = FLAG;
      if (u < 1 && Math.floor(t * 12) % 2) ctx.fillRect(Math.round(x) - 1, Math.round(y) - 2, 3, 4);
      else ctx.fillRect(Math.round(x) - 2, Math.round(y) - 1, 4, 3);
    });
  }

  /** Stop drawing and let go of the canvas. */
  stop(): void {
    this.clear();
  }
}
