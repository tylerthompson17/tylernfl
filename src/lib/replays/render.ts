/**
 * Draws one Retro Replays frame at native resolution (the framing's width
 * by height; the page scales the canvas up with nearest-neighbour pixels).
 * Back to front: the field under the camera, route trails, the stats'
 * marks on the turf, shadows and the carrier's ring, players and the ball
 * sorted by how far up the field they stand, and, when on, the debug
 * layer. Everything in words (scorebug, captions, stat labels) is HTML in
 * the site's type over the canvas, placed through `project`.
 */
import { drawText, textWidth } from './font.ts';
import { FIELD_PX_H, FIELD_PX_W, FIELD_WIDTH, fx, fy, paintField, PX } from './field.ts';
import { BALL, BALL_SHADOW, buildSheet, drawSprite, paintRows, RING, SHADOW, teamPalette } from './sprites.ts';
import {
  ballHeight,
  carrierAt,
  facing,
  sample,
  separationAt,
  stride,
  throwMarkOpacity,
  throwOf,
  type Prepared,
  type ThrowInfo,
} from './timeline.ts';

/**
 * How a replay is framed: All-22, the film room view. On a wide screen the
 * field is in view sideline to sideline and the camera pans only along it,
 * slowly. On a phone the same pixels would be too small, so the view
 * tightens to about 40 yards along the field and follows across it too.
 */
export interface Framing {
  width: number;
  height: number;
  /** Hold the camera at midfield across, panning only along the field */
  lockY: boolean;
}

export const FRAMINGS = {
  wide: { width: 504, height: 336, lockY: true },
  phone: { width: 240, height: 160, lockY: false },
} satisfies Record<string, Framing>;

/** Yards kept between the ball and the top of the view */
const BALL_MARGIN = 2;

/** Below this page width (CSS pixels) a replay uses the phone framing and starts with stats off. */
export const PHONE_MAX_WIDTH = 599;

export interface ReplayColors {
  turf: string;
  mow: string;
  out: string;
  paint: string;
  scrimmage: string;
  lineToGain: string;
  outline: string;
  visor: string;
  mask: string;
  pants: string;
  roadJersey: string;
  shoe: string;
  ball: string;
  shadow: string;
  ring: string;
  debug: string;
  debugPanel: string;
  debugText: string;
}

const TOKENS: Record<keyof ReplayColors, string> = {
  turf: '--replay-turf',
  mow: '--replay-turf-mow',
  out: '--replay-turf-out',
  paint: '--replay-paint',
  scrimmage: '--scrimmage',
  lineToGain: '--highlight',
  outline: '--replay-outline',
  visor: '--replay-visor',
  mask: '--replay-mask',
  pants: '--replay-pants',
  roadJersey: '--replay-road-jersey',
  shoe: '--replay-shoe',
  ball: '--replay-ball',
  shadow: '--replay-shadow',
  ring: '--highlight',
  debug: '--replay-debug',
  debugPanel: '--replay-debug-panel',
  debugText: '--replay-debug-text',
};

/** The replay's colors from the site's tokens (tokens.css). */
export function readColors(el: Element): ReplayColors {
  const style = getComputedStyle(el);
  return Object.fromEntries(
    Object.entries(TOKENS).map(([key, token]) => [key, style.getPropertyValue(token).trim()]),
  ) as unknown as ReplayColors;
}

export interface DrawOptions {
  trails: boolean;
  debug: boolean;
  /** The throw's track and the separation when the ball arrives, drawn on the turf */
  stats: boolean;
}

/** A 1 pixel line between two points, pixel by pixel so it stays crisp; `dash` skips pixels in a pattern. */
function pixelLine(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, dash = 0) {
  let x = Math.round(x0), y = Math.round(y0);
  const tx = Math.round(x1), ty = Math.round(y1);
  const dx = Math.abs(tx - x), dy = -Math.abs(ty - y);
  const sx = x < tx ? 1 : -1, sy = y < ty ? 1 : -1;
  let err = dx + dy;
  for (let step = 0; step < 4000; step++) {
    if (!dash || step % (dash * 2) < dash) ctx.fillRect(x, y, 1, 1);
    if (x === tx && y === ty) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
}

export class ReplayRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly field: HTMLCanvasElement;
  private readonly sheets: Record<'offense' | 'defense', HTMLCanvasElement>;
  private readonly thrown: ThrowInfo | null;
  private origin = { x: 0, y: 0 };

  constructor(
    canvas: HTMLCanvasElement,
    private readonly prep: Prepared,
    private readonly colors: ReplayColors,
    readonly framing: Framing,
  ) {
    canvas.width = framing.width;
    canvas.height = framing.height;
    this.ctx = canvas.getContext('2d')!;
    this.ctx.imageSmoothingEnabled = false;
    const { scene } = prep;
    this.field = paintField(scene, colors);
    this.sheets = {
      offense: buildSheet(teamPalette(scene.teams.offense, scene.play.home === scene.play.offense, colors)),
      defense: buildSheet(teamPalette(scene.teams.defense, scene.play.home === scene.play.defense, colors)),
    };
    this.thrown = throwOf(prep);
  }

  /** Field yards to canvas pixels for the frame drawn last. */
  project(x: number, y: number): { x: number; y: number } {
    return { x: fx(x) - this.origin.x, y: fy(y) - this.origin.y };
  }

  /** Jersey color by side, for trails. */
  private sideColor(side: 'offense' | 'defense'): string {
    const { scene } = this.prep;
    const team = scene.teams[side];
    const home = scene.play.home === scene.play[side];
    return home ? team.primary : this.colors.roadJersey;
  }

  draw(f: number, options: DrawOptions): void {
    const { ctx, prep, colors, framing } = this;
    const { width, height } = framing;

    const camX = sample(prep.camera.x, f) ?? 60;
    let camY = framing.lockY ? FIELD_WIDTH / 2 : (sample(prep.camera.y, f) ?? FIELD_WIDTH / 2);
    // The smoothed path can trail a high kick; never let the ball itself
    // leave the top of the view (screen up is +y, BALL_MARGIN yards in).
    const ballY = sample(prep.ball.y, f);
    if (ballY !== null) camY = Math.max(camY, ballY + ballHeight(prep, f) + BALL_MARGIN - height / 2 / PX);
    const ox = Math.round(Math.min(Math.max(fx(camX) - width / 2, 0), FIELD_PX_W - width));
    const oy = Math.round(Math.min(Math.max(fy(camY) - height / 2, 0), FIELD_PX_H - height));
    this.origin = { x: ox, y: oy };
    const at = (x: number, y: number) => this.project(x, y);

    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(this.field, ox, oy, width, height, 0, 0, width, height);

    if (options.trails) {
      ctx.globalAlpha = 0.45;
      for (const p of prep.players) {
        ctx.fillStyle = this.sideColor(p.side);
        let last: { x: number; y: number } | null = null;
        const end = Math.floor(f);
        for (let i = 0; i <= end + 1; i++) {
          const x = i <= end ? p.x[i] : sample(p.x, f);
          const y = i <= end ? p.y[i] : sample(p.y, f);
          if (x == null || y == null) { last = null; continue; }
          const point = at(x, y);
          if (last) pixelLine(ctx, last.x, last.y, point.x, point.y);
          last = point;
        }
      }
      ctx.globalAlpha = 1;
    }

    if (options.stats) this.drawThrowMarks(f);

    const carrier = carrierAt(prep, f);
    type Drawable = { depth: number; draw: () => void };
    const drawables: Drawable[] = [];
    const depthOf = new Map<number, number>();

    prep.players.forEach((p, i) => {
      const x = sample(p.x, f);
      const y = sample(p.y, f);
      if (x === null || y === null) return;
      const point = at(x, y);
      const px = Math.round(point.x);
      const py = Math.round(point.y);
      paintRows(ctx, SHADOW, { '#': colors.shadow }, px - 4, py - 1);
      if (i === carrier) paintRows(ctx, RING, { '#': colors.ring }, px - 7, py - 2);
      const sheet = this.sheets[p.side];
      depthOf.set(i, py);
      drawables.push({ depth: py, draw: () => drawSprite(ctx, sheet, facing(p, f), stride(p, f), px, py) });
    });

    const bx = sample(prep.ball.x, f);
    const by = sample(prep.ball.y, f);
    if (bx !== null && by !== null) {
      const z = ballHeight(prep, f);
      const ground = at(bx, by);
      const px = Math.round(ground.x);
      const py = Math.round(ground.y);
      if (carrier === null) paintRows(ctx, BALL_SHADOW, { '#': colors.shadow }, px - 2, py - 1);
      const carrierDepth = carrier !== null ? depthOf.get(carrier) : undefined;
      drawables.push({
        // A carried ball sits just in front of its carrier.
        depth: carrierDepth !== undefined ? carrierDepth + 0.5 : py,
        draw: () => paintRows(ctx, BALL, { o: colors.outline, b: colors.ball, w: colors.paint }, px - 2, py - 1 - Math.round(z * PX)),
      });
    }

    drawables.sort((a, b) => a.depth - b.depth).forEach((d) => d.draw());

    if (options.debug) this.drawDebug(f);
  }

  /** The throw's ground track from release to arrival, and the separation when it arrived, fading out after the catch. */
  private drawThrowMarks(f: number): void {
    const { ctx, prep, colors, thrown } = this;
    if (!thrown) return;
    const opacity = throwMarkOpacity(thrown, f, prep.hz);
    if (opacity <= 0) return;
    ctx.globalAlpha = opacity;
    const a = this.project(thrown.release.x, thrown.release.y);
    const b = this.project(thrown.arrival.x, thrown.arrival.y);
    ctx.fillStyle = colors.paint;
    pixelLine(ctx, a.x, a.y, b.x, b.y, 2);
    ctx.fillRect(Math.round(b.x) - 2, Math.round(b.y), 5, 1);
    ctx.fillRect(Math.round(b.x), Math.round(b.y) - 2, 1, 5);
    const gap = thrown.catchFrame !== null && thrown.receiver !== null && f >= thrown.to ? separationAt(prep, thrown.to, thrown.receiver) : null;
    if (gap) {
      const r = prep.players[thrown.receiver!]!;
      const d = prep.players[gap.defender]!;
      const t = thrown.to;
      const rp = this.project(r.x[t]!, r.y[t]!);
      const dp = this.project(d.x[t]!, d.y[t]!);
      ctx.fillStyle = colors.lineToGain;
      pixelLine(ctx, rp.x, rp.y, dp.x, dp.y);
      // A mark at each end, so the line reads as the two players' spots when the ball arrived.
      for (const end of [rp, dp]) ctx.fillRect(Math.round(end.x) - 1, Math.round(end.y) - 1, 3, 3);
    }
    ctx.globalAlpha = 1;
  }

  /** Raw tracking dots at the nearest frame, jersey numbers, the carrier, frame and events. */
  private drawDebug(f: number): void {
    const { ctx, prep, colors } = this;
    const i = Math.min(Math.max(Math.round(f), 0), prep.frames - 1);
    const small = (color: string) => ({ color, bold: false });
    prep.players.forEach((p) => {
      const x = p.x[i], y = p.y[i];
      if (x == null || y == null) return;
      const point = this.project(x, y);
      const px = Math.round(point.x), py = Math.round(point.y);
      ctx.fillStyle = colors.outline;
      ctx.fillRect(px - 2, py - 2, 5, 5);
      ctx.fillStyle = p.side === 'offense' ? colors.paint : colors.debug;
      ctx.fillRect(px - 1, py - 1, 3, 3);
      if (p.jersey !== null) drawText(ctx, String(p.jersey), px + 3, py + 1, small(colors.paint));
    });
    const ball = this.project(prep.ball.x[i]!, prep.ball.y[i]!);
    const bpx = Math.round(ball.x), bpy = Math.round(ball.y);
    ctx.fillStyle = colors.debug;
    ctx.fillRect(bpx - 1, bpy - 1, 3, 3);

    const c = carrierAt(prep, f);
    const holder = c === null ? null : prep.players[c];
    const recent = prep.scene.events.filter((e) => e.frame <= i).slice(-3);
    const lines = [
      `F ${i}/${prep.frames - 1}  T ${(f / prep.hz).toFixed(1)}S`,
      `CARRIER ${holder ? `${c} #${holder.jersey ?? '?'} ${holder.name}` : '-'}`,
      ...recent.map((e) => `${e.frame} ${e.name}`),
    ];
    const w = Math.max(...lines.map((l) => textWidth(l, { bold: false }))) + 6;
    ctx.fillStyle = colors.debugPanel;
    ctx.fillRect(2, 2, w, lines.length * 9 + 3);
    lines.forEach((line, n) => drawText(ctx, line, 5, 4 + n * 9, small(colors.debugText)));
    // The event of this frame, if any, labelled at the ball.
    const now = prep.scene.events.filter((e) => Math.abs(e.frame - f) < 3);
    now.forEach((e, n) => drawText(ctx, e.name, bpx + 4, bpy - 10 - n * 9, small(colors.debug)));
  }
}
