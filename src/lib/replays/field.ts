/**
 * The Retro Replays field, painted once per scene onto its own canvas at
 * the replay's native resolution. The renderer copies the camera's window
 * out of it each frame.
 */
import type { ReplayScene } from '../../data/types.ts';
import { drawText, textWidth } from './font.ts';

/** Pixels per yard at native resolution */
export const PX = 6;
/** Yards shown beyond the field on every side */
export const MARGIN_X = 10;
export const MARGIN_Y = 6;
export const FIELD_LENGTH = 120;
export const FIELD_WIDTH = 53.3;
/** Inbound hash marks, yards from the near sideline (70 feet 9 inches) */
export const HASH_Y = [23.58, FIELD_WIDTH - 23.58];

export const FIELD_PX_W = Math.round((FIELD_LENGTH + 2 * MARGIN_X) * PX);
export const FIELD_PX_H = Math.round((FIELD_WIDTH + 2 * MARGIN_Y) * PX);

/** Field yards to pixels on the field canvas (unrounded). */
export const fx = (x: number) => (x + MARGIN_X) * PX;
export const fy = (y: number) => (FIELD_WIDTH + MARGIN_Y - y) * PX;

export interface FieldColors {
  turf: string;
  mow: string;
  out: string;
  paint: string;
  scrimmage: string;
  lineToGain: string;
}

function vline(ctx: CanvasRenderingContext2D, x: number, y0: number, y1: number, width: number) {
  ctx.fillRect(Math.round(fx(x) - width / 2), Math.round(fy(y1)), width, Math.round(fy(y0) - fy(y1)));
}

function hline(ctx: CanvasRenderingContext2D, y: number, x0: number, x1: number, width: number) {
  ctx.fillRect(Math.round(fx(x0)), Math.round(fy(y) - width / 2), Math.round(fx(x1) - fx(x0)), width);
}

/** A hex color mixed toward another: `amount` 0 is `a`, 1 is `b`. */
export function mixHex(a: string, b: string, amount: number): string {
  const parse = (hex: string) => {
    const n = parseInt(hex.replace('#', ''), 16);
    return [n >> 16, (n >> 8) & 0xff, n & 0xff];
  };
  const [ca, cb] = [parse(a), parse(b)];
  return `#${ca.map((v, i) => Math.round(v + (cb[i]! - v) * amount).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * A film room field: muted turf with barely there mow stripes, end zones
 * a tint of the team color, yard lines every 5, goal lines and sidelines,
 * inbound hashes only, small numbers every 10 (no arrows), the line of
 * scrimmage and line to gain.
 */
export function paintField(scene: ReplayScene, colors: FieldColors): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = FIELD_PX_W;
  canvas.height = FIELD_PX_H;
  const ctx = canvas.getContext('2d')!;
  const top = Math.round(fy(FIELD_WIDTH));
  const height = Math.round(fy(0)) - top;

  ctx.fillStyle = colors.out;
  ctx.fillRect(0, 0, FIELD_PX_W, FIELD_PX_H);
  for (let x = 10; x < 110; x += 5) {
    ctx.fillStyle = (x / 5) % 2 === 0 ? colors.turf : colors.mow;
    ctx.fillRect(Math.round(fx(x)), top, Math.round(fx(x + 5)) - Math.round(fx(x)), height);
  }
  const zones: [number, { abbr: string; primary: string }, number][] = [
    [0, scene.teams.offense, -Math.PI / 2],
    [110, scene.teams.defense, Math.PI / 2],
  ];
  for (const [x, team, turn] of zones) {
    ctx.fillStyle = mixHex(colors.turf, team.primary, 0.45);
    ctx.fillRect(Math.round(fx(x)), top, Math.round(fx(x + 10)) - Math.round(fx(x)), height);
    const style = { color: colors.paint, scale: 2, bold: false } as const;
    ctx.save();
    ctx.translate(Math.round(fx(x + 5)), Math.round(fy(FIELD_WIDTH / 2)));
    ctx.rotate(turn);
    drawText(ctx, team.abbr, -Math.round(textWidth(team.abbr, style) / 2), -7, style);
    ctx.restore();
  }

  ctx.fillStyle = colors.paint;
  hline(ctx, 0, 0, FIELD_LENGTH, 2);
  hline(ctx, FIELD_WIDTH, 0, FIELD_LENGTH, 2);
  for (const x of [0, 10, 110, 120]) vline(ctx, x, 0, FIELD_WIDTH, 2);
  ctx.globalAlpha = 0.55;
  for (let x = 15; x <= 105; x += 5) vline(ctx, x, 0, FIELD_WIDTH, 1);
  for (let x = 11; x < 110; x++) {
    if (x % 5 === 0) continue;
    for (const y of HASH_Y) ctx.fillRect(Math.round(fx(x)), Math.round(fy(y)) - 1, 1, 2);
  }
  ctx.globalAlpha = 0.8;
  const style = { color: colors.paint, bold: false } as const;
  for (let yard = 20; yard <= 100; yard += 10) {
    const label = String(yard <= 60 ? yard - 10 : 110 - yard);
    const w = textWidth(label, style);
    drawText(ctx, label, Math.round(fx(yard) - w / 2), Math.round(fy(9)), style);
    ctx.save();
    ctx.translate(Math.round(fx(yard)), Math.round(fy(FIELD_WIDTH - 9)));
    ctx.rotate(Math.PI);
    drawText(ctx, label, -Math.round(w / 2), 0, style);
    ctx.restore();
  }
  ctx.globalAlpha = 1;

  const { lineOfScrimmage, firstDown } = scene.field;
  if (firstDown !== null) {
    ctx.fillStyle = colors.lineToGain;
    vline(ctx, firstDown, 0, FIELD_WIDTH, 2);
  }
  if (lineOfScrimmage !== null) {
    ctx.fillStyle = colors.scrimmage;
    vline(ctx, lineOfScrimmage, 0, FIELD_WIDTH, 2);
  }
  return canvas;
}
