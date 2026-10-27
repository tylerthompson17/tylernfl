/**
 * The intro's touchdown moment (src/lib/replays/intro.ts): pixel confetti
 * in the scoring team's colours bursts over the full-screen replay and a
 * big TOUCHDOWN slams in, in the replay's own pixel font, with the score
 * under it. Drawn on a low-resolution canvas over the window and scaled up
 * with hard pixel edges, like the replay itself.
 */
import { drawText, textWidth } from './font.ts';

/** How long the moment runs before the intro may shrink the replay */
export const CELEBRATE_MS = 3000;

const OUTLINE = '#14161a';
const WORD = 'TOUCHDOWN';

interface Bit {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  phase: number;
}

/** A colour light enough to read on the field, else white */
export function bright(hex: string | undefined): string {
  const m = hex?.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return '#ffffff';
  const [r, g, b] = m.slice(1).map((h) => parseInt(h, 16));
  return 0.299 * r! + 0.587 * g! + 0.114 * b! > 120 ? hex! : '#ffffff';
}

/** Text with a one pixel dark outline and a drop shadow, centred on x */
export function shout(ctx: CanvasRenderingContext2D, text: string, cx: number, y: number, scale: number, color: string, shadow: string) {
  const x = Math.round(cx - textWidth(text, { scale }) / 2);
  const s = Math.max(1, Math.round(scale / 3));
  drawText(ctx, text, x + s, y + s, { color: shadow, scale });
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) drawText(ctx, text, x + dx, y + dy, { color: OUTLINE, scale });
  drawText(ctx, text, x, y, { color, scale });
}

/** Start the moment; the returned function removes it. `colors` are the team's primary and secondary. */
export function celebrate(colors: string[], line: string): { canvas: HTMLCanvasElement; stop: () => void } {
  const P = Math.max(3, Math.round(Math.min(innerWidth, innerHeight) / 170));
  const cols = Math.ceil(innerWidth / P);
  const rows = Math.ceil(innerHeight / P);
  const canvas = document.createElement('canvas');
  canvas.width = cols;
  canvas.height = rows;
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText =
    'position: fixed; inset: 0; width: 100%; height: 100%; z-index: 1001; pointer-events: none; image-rendering: pixelated;';
  document.body.append(canvas);
  const ctx = canvas.getContext('2d')!;

  const [primary = '#4f2683', secondary] = colors;
  const word = bright(secondary);
  const palette = [primary, word, '#ffffff', primary, word];
  const pick = () => palette[Math.floor(Math.random() * palette.length)]!;
  const bits: Bit[] = [];
  // Cannons from both bottom corners, then a shower from the top.
  for (const dir of [1, -1]) {
    for (let i = 0; i < 140; i++) {
      bits.push({
        x: dir > 0 ? 0 : cols,
        y: rows,
        vx: dir * cols * (0.12 + Math.random() * 0.5),
        vy: -rows * (0.9 + Math.random() * 0.75),
        color: pick(),
        phase: Math.random() * 10,
      });
    }
  }
  for (let i = 0; i < 160; i++) {
    bits.push({ x: Math.random() * cols, y: -Math.random() * rows * 0.8, vx: (Math.random() - 0.5) * cols * 0.05, vy: rows * 0.15, color: pick(), phase: Math.random() * 10 });
  }

  const big = Math.max(1, Math.floor((cols * 0.82) / textWidth(WORD, { scale: 1 })));
  const small = Math.max(1, Math.round(big / 2.5));
  const t0 = performance.now();
  let last = t0;
  let raf = 0;
  function frame(now: number) {
    const t = (now - t0) / 1000;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    ctx.clearRect(0, 0, cols, rows);

    // Confetti: gravity, air drag, and a slow flutter once it is falling.
    for (const b of bits) {
      b.vy = Math.min(b.vy + rows * 1.3 * dt, rows * 0.22);
      b.vx *= Math.exp(-1.6 * dt);
      b.x += (b.vx + Math.sin(t * 5 + b.phase) * cols * 0.02) * dt;
      b.y += b.vy * dt;
      if (b.y < -2 || b.y > rows) continue;
      ctx.fillStyle = b.color;
      if (Math.floor(t * 9 + b.phase) % 2) ctx.fillRect(Math.round(b.x), Math.round(b.y), 2, 1);
      else ctx.fillRect(Math.round(b.x), Math.round(b.y), 1, 2);
    }

    // TOUCHDOWN slams in from twice its size, shakes, and flashes white a few times.
    const slam = Math.min(1, t / 0.22);
    const scale = Math.max(big, Math.round(big * (2.2 - 1.2 * slam * slam)));
    const shake = t > 0.22 && t < 0.55 ? Math.round((Math.random() - 0.5) * 2 * Math.max(1, big / 3)) : 0;
    const flash = t < 0.9 && Math.floor(t / 0.12) % 2 === 1;
    const h = 7 * scale;
    const y = Math.round(rows * 0.42 - h / 2) + shake;
    shout(ctx, WORD, cols / 2 + shake, y, scale, flash ? '#ffffff' : word, primary);
    if (t > 0.35 && line) shout(ctx, line, cols / 2, y + h + Math.max(3, big * 2), small, '#ffffff', primary);

    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);
  return {
    canvas,
    stop: () => {
      cancelAnimationFrame(raf);
      canvas.remove();
    },
  };
}
