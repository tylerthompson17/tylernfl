/**
 * Retro Replays motion, kept free of the DOM so the tests run it in Node:
 * where everything is at a fractional frame, how fast players move, which
 * way a sprite faces, how high the ball is, where the camera looks, and
 * what the scoreboard says. Positions are yards on the 120 by 53.3 field,
 * the featured team driving toward +x; +y is up the screen.
 *
 * A scene needs only the ball's path. Players, the carrier and the ball's
 * height are optional, so a play drawn from play-by-play alone (no
 * tracking) runs through the same code.
 */
import type { ReplayScene } from '../../data/types.ts';

/** Gravity in yards per second squared, for the ball's arc */
export const GRAVITY = 10.7;
/** A pass or kick arrives at this height (yards), and a pass leaves the passer's hand at it */
export const FLIGHT_END_HEIGHT = 2;
/** Where a flight starts, by kind (yards): a kickoff off the tee, a punt off the foot, a pass from the hand */
export const FLIGHT_START_HEIGHT: Record<string, number> = { kick: 0, punt: 1, snap: 0.5, pass: FLIGHT_END_HEIGHT };
/** A carried ball's height (yards): about the hands of a sprite */
export const CARRY_HEIGHT = 1.5;
/** Faster than this (yards a second), a player faces where he is going; slower, where his body points */
export const MOVING_SPEED = 1;
/** Slower than this, a sprite stands instead of running */
export const STAND_SPEED = 0.6;
/** Yards covered by one full run cycle (four sprite frames) */
export const STRIDE_YARDS = 1.8;
/** How long an event's caption stays up, in seconds */
export const CAPTION_SECONDS = 1.2;
/** Camera smoothing per frame, run forward and back so it neither lags nor leads: small, for a slow steady pan */
export const CAMERA_SMOOTHING = 0.06;

export type Series = (number | null)[];

export interface PreparedPlayer {
  id: string;
  side: 'featured' | 'opponent';
  jersey: number | null;
  name: string;
  position: string | null;
  x: Series;
  y: Series;
  dir: Series;
  o: Series;
  /** Yards a second, from positions */
  speed: Series;
  /** Yards covered since the first frame, for the run cycle */
  distance: Series;
}

export interface Prepared {
  scene: ReplayScene;
  hz: number;
  frames: number;
  ball: { x: number[]; y: number[]; z: Series | null };
  players: PreparedPlayer[];
  carrier: Series;
  camera: { x: number[]; y: number[] };
  snapFrame: number;
  /** The frame the game clock starts running: the snap, or on a kickoff the return man's touch */
  clockFrame: number;
}

const START_EVENTS = new Set(['ball_snap', 'snap_direct', 'kickoff', 'onside_kick']);

function scaled(values: Series | undefined, scale: number, length: number): Series {
  if (!values) return new Array(length).fill(null);
  return values.map((v) => (v === null ? null : v / scale));
}

/** Speed at each frame from the positions either side of it. */
export function speeds(x: Series, y: Series, hz: number): Series {
  return x.map((_, i) => {
    const a = Math.max(0, i - 1);
    const b = Math.min(x.length - 1, i + 1);
    const ax = x[a], ay = y[a], bx = x[b], by = y[b];
    if (a === b || ax == null || ay == null || bx == null || by == null) return null;
    return Math.hypot(bx - ax, by - ay) / ((b - a) / hz);
  });
}

/** Distance covered by each frame, counting only steps with both ends known. */
export function distances(x: Series, y: Series): Series {
  let total = 0;
  return x.map((xi, i) => {
    const yi = y[i];
    if (xi == null || yi == null) return null;
    const px = x[i - 1], py = y[i - 1];
    if (i > 0 && px != null && py != null) total += Math.hypot(xi - px, yi - py);
    return total;
  });
}

/** Zero-phase exponential smoothing: forward, then back over the result. */
export function smooth(values: number[], alpha = CAMERA_SMOOTHING): number[] {
  if (values.length === 0) return [];
  const forward = [...values];
  for (let i = 1; i < forward.length; i++) forward[i] = forward[i - 1]! + alpha * (values[i]! - forward[i - 1]!);
  const back = [...forward];
  for (let i = back.length - 2; i >= 0; i--) back[i] = back[i + 1]! + alpha * (forward[i]! - back[i + 1]!);
  return back;
}

export function prepare(scene: ReplayScene): Prepared {
  const n = scene.frameCount;
  const s = scene.scale;
  const hz = scene.hz;
  const players: PreparedPlayer[] = (scene.players ?? []).map((p) => {
    const x = scaled(p.x, s, n);
    const y = scaled(p.y, s, n);
    return {
      id: p.id,
      side: p.side,
      jersey: p.jersey,
      name: p.name,
      position: p.position,
      x,
      y,
      dir: p.dir ?? new Array(n).fill(null),
      o: p.o ?? new Array(n).fill(null),
      speed: speeds(x, y, hz),
      distance: distances(x, y),
    };
  });
  const ball = {
    x: scene.ball.x.map((v) => v / s),
    y: scene.ball.y.map((v) => v / s),
    z: scene.ball.z ? scaled(scene.ball.z, s, n) : null,
  };
  const carrier: Series = scene.carrier ?? new Array(n).fill(null);
  // The camera looks at whoever has the ball, else the ball itself; in
  // the air, halfway up to it, so a high kick and its shadow both stay in
  // view (screen up is +y).
  const targetX: number[] = [];
  const targetY: number[] = [];
  for (let f = 0; f < n; f++) {
    const c = carrier[f];
    const p = c == null ? undefined : players[c];
    const px = p?.x[f];
    const py = p?.y[f];
    targetX.push(px ?? ball.x[f]!);
    targetY.push((py ?? ball.y[f]!) + flightHeight(scene, f) / 2);
  }
  const snap = scene.events.find((e) => START_EVENTS.has(e.name));
  const snapFrame = snap ? snap.frame : 0;
  return {
    scene,
    hz,
    frames: n,
    ball,
    players,
    carrier,
    camera: { x: smooth(targetX), y: smooth(targetY) },
    snapFrame,
    clockFrame: clockStart(scene, snapFrame),
  };
}

/**
 * When the game clock starts. From the snap, except on a kickoff, where it
 * waits for the return man to touch the ball (and never starts on a
 * touchback, so the last frame stands in for that).
 */
export function clockStart(scene: ReplayScene, snapFrame: number): number {
  if (scene.play.type !== 'kickoff') return snapFrame;
  const touch = scene.events.find((e) => e.frame >= snapFrame && (e.name === 'kick_received' || e.name === 'onside_kick'));
  return touch ? touch.frame : scene.frameCount - 1;
}

/** A series at a fractional frame, linear between frames; a gap holds the known side. */
export function sample(values: Series, f: number): number | null {
  const last = values.length - 1;
  const t = Math.min(Math.max(f, 0), last);
  const i = Math.floor(t);
  const u = t - i;
  const a = values[i] ?? null;
  const b = i + 1 <= last ? (values[i + 1] ?? null) : a;
  if (a === null) return b;
  if (b === null) return a;
  return a + (b - a) * u;
}

/** Blend two compass angles the short way round. */
export function lerpAngle(a: number, b: number, u: number): number {
  const d = ((((b - a) % 360) + 540) % 360) - 180;
  return (((a + d * u) % 360) + 360) % 360;
}

export function sampleAngle(values: Series, f: number): number | null {
  const last = values.length - 1;
  const t = Math.min(Math.max(f, 0), last);
  const i = Math.floor(t);
  const a = values[i] ?? null;
  const b = i + 1 <= last ? (values[i + 1] ?? null) : a;
  if (a === null) return b;
  if (b === null) return a;
  return lerpAngle(a, b, t - i);
}

/**
 * Which of eight ways a compass angle faces on screen: 0 away from the
 * camera (up), 2 right, 4 toward the camera (down), 6 left.
 */
export function octant(angle: number): number {
  const a = ((angle % 360) + 360) % 360;
  return Math.round(a / 45) % 8;
}

/** Where a player faces: his direction of travel when moving, else his body's orientation. */
export function facing(p: PreparedPlayer, f: number): number {
  const speed = sample(p.speed, f) ?? 0;
  const travel = sampleAngle(p.dir, f);
  const body = sampleAngle(p.o, f);
  const angle = speed > MOVING_SPEED ? (travel ?? body) : (body ?? travel);
  if (angle !== null) return octant(angle);
  return p.side === 'featured' ? 2 : 6;
}

/** Run cycle frame: 0 standing, 1 to 4 running, advanced by distance so speed drives it. */
export function stride(p: PreparedPlayer, f: number): number {
  const speed = sample(p.speed, f) ?? 0;
  if (speed < STAND_SPEED) return 0;
  const covered = sample(p.distance, f) ?? 0;
  return 1 + (Math.floor((covered / STRIDE_YARDS) * 4) % 4);
}

/** Height of a ball arc t seconds into a flight of T seconds: a parabola under GRAVITY from FLIGHT_END_HEIGHT back to it. */
export function arcHeight(t: number, T: number, start = FLIGHT_END_HEIGHT, end = FLIGHT_END_HEIGHT): number {
  const u = Math.min(Math.max(t, 0), T);
  return start + (end - start) * (T > 0 ? u / T : 1) + 0.5 * GRAVITY * u * (T - u);
}

/** A scene's drawn arc height at a frame, 0 outside its flights. */
export function flightHeight(scene: ReplayScene, f: number): number {
  for (const flight of scene.flights) {
    if (f >= flight.from && f <= flight.to) {
      const start = FLIGHT_START_HEIGHT[flight.kind] ?? FLIGHT_END_HEIGHT;
      return arcHeight((f - flight.from) / scene.hz, (flight.to - flight.from) / scene.hz, start);
    }
  }
  return 0;
}

export function carrierAt(prep: Prepared, f: number): number | null {
  const i = Math.min(Math.max(Math.round(f), 0), prep.frames - 1);
  return prep.carrier[i] ?? null;
}

/** The ball's height in yards: the scene's own when it has one, else an arc in flight, carry height when held, the ground when loose. */
export function ballHeight(prep: Prepared, f: number): number {
  if (prep.ball.z) {
    const z = sample(prep.ball.z, f);
    if (z !== null) return z;
  }
  if (prep.scene.flights.some((fl) => f >= fl.from && f <= fl.to)) return flightHeight(prep.scene, f);
  return carrierAt(prep, f) === null ? 0 : CARRY_HEIGHT;
}

/** The game clock: stopped before the snap, running from it. */
export function clockAt(clock: string, seconds: number): string {
  const [m, s] = clock.split(':').map(Number);
  const left = Math.max(0, (m ?? 0) * 60 + (s ?? 0) - Math.floor(Math.max(0, seconds)));
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
}

export function clockAtFrame(prep: Prepared, f: number): string {
  return clockAt(prep.scene.play.clock, (f - prep.clockFrame) / prep.hz);
}

const SCORING = new Set(['touchdown', 'pass_outcome_touchdown', 'field_goal', 'safety', 'extra_point']);
/** Events whose caption stays up for the rest of the play */
const STAYS = new Set(['touchdown', 'pass_outcome_touchdown']);

/** The score on the board: the one before the snap until a scoring event, then the one after. */
export function scoreAt(scene: ReplayScene, f: number): { home: number; away: number } {
  const scored = scene.events.find((e) => SCORING.has(e.name));
  if (scene.play.scoreAfter && scored && f >= scored.frame) return scene.play.scoreAfter;
  return scene.play.scoreBefore;
}

// Data overlays ----------------------------------------------------------

export const MPH_PER_YARD_PER_SECOND = 3600 / 1760;
/** The throw's marks (track, air yards, separation) stay up this long after the catch, then fade over THROW_FADE (seconds) */
export const THROW_HOLD = 1;
export const THROW_FADE = 0.4;

export const mph = (yardsPerSecond: number) => yardsPerSecond * MPH_PER_YARD_PER_SECOND;

export interface ThrowInfo {
  from: number;
  to: number;
  release: { x: number; y: number };
  arrival: { x: number; y: number };
  /** Yards past the line of scrimmage where the ball arrived, the way the passing team goes; null without a line */
  airYards: number | null;
  /** Who has the ball once it arrives (index into players), if anyone */
  receiver: number | null;
  /** The frame it was caught, when it was */
  catchFrame: number | null;
}

/**
 * How visible the throw's marks are at a frame, 0 to 1: from the throw
 * until THROW_HOLD after the catch (or the ball's arrival when it was not
 * caught), then fading out over THROW_FADE.
 */
export function throwMarkOpacity(thrown: ThrowInfo, f: number, hz: number): number {
  if (f < thrown.from) return 0;
  const hold = (thrown.catchFrame ?? thrown.to) + THROW_HOLD * hz;
  if (f <= hold) return 1;
  return Math.max(0, 1 - (f - hold) / (THROW_FADE * hz));
}

/** The play's first forward pass, if it has one. */
export function throwOf(prep: Prepared): ThrowInfo | null {
  const flight = prep.scene.flights.find((fl) => fl.kind === 'pass');
  if (!flight) return null;
  const los = prep.scene.field.lineOfScrimmage;
  const arrival = { x: prep.ball.x[flight.to]!, y: prep.ball.y[flight.to]! };
  let receiver: number | null = null;
  for (let f = flight.to; f < Math.min(prep.frames, flight.to + 5) && receiver === null; f++) receiver = prep.carrier[f] ?? null;
  const caught = prep.scene.events.find((e) => e.name === 'pass_outcome_caught' && e.frame >= flight.to);
  return {
    from: flight.from,
    to: flight.to,
    release: { x: prep.ball.x[flight.from]!, y: prep.ball.y[flight.from]! },
    arrival,
    airYards: los === null ? null : Math.round(prep.scene.field.attack * (arrival.x - los)),
    receiver,
    catchFrame: caught && receiver !== null ? caught.frame : null,
  };
}

/**
 * The nearest defender to a player at a frame, and how far away. Separation
 * is measured when the ball arrives (`ThrowInfo.to`, the pass_arrived
 * frame), as Next Gen Stats measures it.
 */
export function separationAt(prep: Prepared, frame: number, player: number): { defender: number; yards: number } | null {
  const p = prep.players[player];
  const px = p?.x[frame], py = p?.y[frame];
  if (!p || px == null || py == null) return null;
  let best: { defender: number; yards: number } | null = null;
  for (let i = 0; i < prep.players.length; i++) {
    const d = prep.players[i]!;
    const dx = d.x[frame], dy = d.y[frame];
    if (d.side === p.side || dx == null || dy == null) continue;
    const yards = Math.hypot(dx - px, dy - py);
    if (!best || yards < best.yards) best = { defender: i, yards };
  }
  return best;
}

/** Whose speed the tag shows: the carrier, or while a pass is in the air, the player it is going to. */
export function speedTagPlayer(prep: Prepared, f: number, thrown: ThrowInfo | null): number | null {
  const carrier = carrierAt(prep, f);
  if (carrier !== null) return carrier;
  if (thrown && f >= thrown.from && f <= thrown.to) return thrown.receiver;
  return null;
}

/** Captions in the site's words, sentence case. */
export const CAPTION_WORDS: Record<string, string> = {
  ball_snap: 'Snap',
  handoff: 'Handoff',
  pass_forward: 'Pass',
  pass_shovel: 'Shovel pass',
  pass_outcome_caught: 'Catch',
  pass_outcome_incomplete: 'Incomplete',
  pass_outcome_interception: 'Interception',
  kickoff: 'Kickoff',
  punt: 'Punt',
  punt_blocked: 'Blocked punt',
  kick_received: 'Return',
  punt_received: 'Return',
  fair_catch: 'Fair catch',
  touchback: 'Touchback',
  fumble: 'Fumble',
  qb_sack: 'Sack',
  qb_strip_sack: 'Strip sack',
  tackle: 'Tackled',
  out_of_bounds: 'Out of bounds',
  safety: 'Safety',
  touchdown: 'Touchdown',
  pass_outcome_touchdown: 'Touchdown',
};

/** The latest event to caption, by the same timing as the pixel captions. */
export function captionEventAt(scene: ReplayScene, f: number): string | null {
  let name: string | null = null;
  for (const e of scene.events) {
    if (e.frame > f || !(e.name in CAPTION_WORDS)) continue;
    name = STAYS.has(e.name) || f - e.frame <= CAPTION_SECONDS * scene.hz ? e.name : null;
  }
  return name;
}

// The play as it unfolds: win probability, the end of the game, effects --

/** Events that put the win probability at its after value at once */
const DECIDING = new Set(['touchdown', 'pass_outcome_touchdown', 'safety', 'field_goal']);
/** A ball that ends closer than this to where it was snapped (yards) moves the win probability with time instead */
const WP_MIN_TRAVEL = 3;

/**
 * Share of the way from the win probability before the play to after it,
 * per frame: 0 to the snap, then how far the ball has come toward where it
 * ends (the featured team always goes toward +x), never going back, and 1
 * from a score, or the last frame. A ball that hardly moves goes by time.
 * nflfastR has no value inside a play, so this is a reading aid that only
 * ever lands on its two published numbers.
 */
export function wpProgress(prep: Prepared): number[] {
  const last = prep.frames - 1;
  const decided = prep.scene.events.find((e) => DECIDING.has(e.name) && e.frame >= prep.snapFrame);
  const end = Math.min(last, decided ? decided.frame : last);
  const from = prep.ball.x[prep.snapFrame]!;
  const to = prep.ball.x[end]!;
  const byTime = Math.abs(to - from) < WP_MIN_TRAVEL;
  let most = 0;
  return Array.from({ length: prep.frames }, (_, f) => {
    if (f <= prep.snapFrame) return 0;
    if (f >= end) return 1;
    const u = byTime ? (f - prep.snapFrame) / (end - prep.snapFrame) : (prep.ball.x[f]! - from) / (to - from);
    most = Math.max(most, Math.min(1, u));
    return most;
  });
}

/** The featured team's win probability at a frame, from `wpProgress`; null without both numbers. */
export function wpAt(prep: Prepared, progress: number[], f: number): number | null {
  const { wpBefore, wpAfter } = prep.scene.play;
  if (wpBefore === null || wpAfter === null) return wpBefore;
  return wpBefore + (wpAfter - wpBefore) * (sample(progress, f) ?? 0);
}

const TOUCHDOWNS = new Set(['touchdown', 'pass_outcome_touchdown']);

/**
 * Whether the game ended on this play: in overtime, a touchdown or a
 * safety; in the 4th quarter, the clock run out at the last frame with a
 * team ahead, and after a touchdown only when the scorer leads, since the
 * league skips the try then.
 */
export function endsGame(prep: Prepared): boolean {
  const { play, events } = prep.scene;
  const after = play.scoreAfter ?? play.scoreBefore;
  if (play.quarter < 4 || after.home === after.away) return false;
  const touchdown = events.some((e) => TOUCHDOWNS.has(e.name));
  if (play.quarter >= 5 && (touchdown || events.some((e) => e.name === 'safety'))) return true;
  if (clockAtFrame(prep, prep.frames - 1) !== '0:00') return false;
  if (!touchdown) return true;
  const scorer = after.home - play.scoreBefore.home > after.away - play.scoreBefore.away ? 'home' : 'away';
  const other = scorer === 'home' ? 'away' : 'home';
  return after[scorer] > after[other];
}

/** A carrier at or over this speed (mph) gets speed lines */
export const FAST_MPH = 18;

export type EffectKind =
  | 'snap'
  | 'throw'
  | 'kick'
  | 'catch'
  | 'incomplete'
  | 'hit'
  | 'whistle'
  | 'interception'
  | 'fumble'
  | 'sack'
  | 'blocked'
  | 'flag'
  | 'touchdown'
  | 'safety';

const EFFECTS: Record<string, EffectKind> = {
  ball_snap: 'snap',
  snap_direct: 'snap',
  pass_forward: 'throw',
  pass_shovel: 'throw',
  lateral: 'throw',
  kickoff: 'kick',
  onside_kick: 'kick',
  punt: 'kick',
  field_goal_attempt: 'kick',
  pass_outcome_caught: 'catch',
  kick_received: 'catch',
  punt_received: 'catch',
  pass_outcome_incomplete: 'incomplete',
  first_contact: 'hit',
  tackle: 'whistle',
  out_of_bounds: 'whistle',
  fair_catch: 'whistle',
  touchback: 'whistle',
  pass_outcome_interception: 'interception',
  fumble: 'fumble',
  fumble_defense_recovered: 'fumble',
  qb_sack: 'sack',
  qb_strip_sack: 'sack',
  punt_blocked: 'blocked',
  touchdown: 'touchdown',
  pass_outcome_touchdown: 'touchdown',
  safety: 'safety',
  penalty_flag: 'flag',
};

/** Kinds that happen once a play however many events name them (a pass touchdown, a fumble and its recovery) */
const ONCE = new Set<EffectKind>(['touchdown', 'fumble']);

/** The moments that get an effect and a sound, in frame order. */
export function effectsOf(scene: ReplayScene): { frame: number; kind: EffectKind }[] {
  const out: { frame: number; kind: EffectKind }[] = [];
  for (const e of [...scene.events].sort((a, b) => a.frame - b.frame)) {
    const kind = EFFECTS[e.name];
    if (!kind || (ONCE.has(kind) && out.some((o) => o.kind === kind))) continue;
    out.push({ frame: e.frame, kind });
  }
  return out;
}

/** A defender this close to the carrier (yards) is in on him */
export const MISS_CLOSE = 1;
/** ...and has missed once the carrier is this far clear of him (yards) */
export const MISS_CLEAR = 2.5;
/** ...within this long (seconds), still carrying, with nothing ending the run */
export const MISS_WINDOW = 1;
/** A carrier slower than this (yards a second) is being wrapped up, not slipping a tackle */
const MISS_MIN_SPEED = 2;
const RUN_ENDS = new Set(['tackle', 'out_of_bounds', 'touchdown', 'pass_outcome_touchdown', 'fumble', 'qb_sack', 'qb_strip_sack', 'safety']);

export interface NearMiss {
  /** The frame the defender was closest */
  frame: number;
  defender: number;
  carrier: number;
  /** How close he got, yards */
  yards: number;
}

/**
 * Tackles the carrier slipped, from tracking alone: a defender closes to
 * within MISS_CLOSE, then the same carrier, still moving, is MISS_CLEAR
 * away from him within MISS_WINDOW with no tackle, score or fumble in
 * between. At most one a defender, and none within half a second of
 * another, so a crowd at the line reads as one moment.
 */
export function nearMisses(prep: Prepared): NearMiss[] {
  const window = Math.round(MISS_WINDOW * prep.hz);
  const ends = prep.scene.events.filter((e) => RUN_ENDS.has(e.name)).map((e) => e.frame);
  const gap = (a: PreparedPlayer, b: PreparedPlayer, f: number) => {
    const ax = a.x[f], ay = a.y[f], bx = b.x[f], by = b.y[f];
    return ax == null || ay == null || bx == null || by == null ? null : Math.hypot(ax - bx, ay - by);
  };
  const found: NearMiss[] = [];
  prep.players.forEach((d, di) => {
    for (let f = Math.max(1, prep.snapFrame); f < prep.frames - 1; f++) {
      const ci = prep.carrier[f];
      const c = ci == null ? undefined : prep.players[ci];
      if (!c || c.side === d.side || (c.speed[f] ?? 0) < MISS_MIN_SPEED) continue;
      const here = gap(c, d, f);
      const before = gap(c, d, f - 1);
      const after = gap(c, d, f + 1);
      if (here === null || here >= MISS_CLOSE || (before !== null && before < here) || (after !== null && after < here)) continue;
      for (let g = f + 1; g <= Math.min(prep.frames - 1, f + window); g++) {
        if (prep.carrier[g] !== ci || ends.some((e) => e >= f && e <= g + 2)) break;
        if ((gap(c, d, g) ?? 0) > MISS_CLEAR) {
          found.push({ frame: f, defender: di, carrier: ci!, yards: here });
          return;
        }
      }
    }
  });
  found.sort((a, b) => a.frame - b.frame);
  return found.filter((m, i) => i === 0 || m.frame - found[i - 1]!.frame >= prep.hz / 2);
}

/**
 * The frame the carrier takes the ball past the line to gain, for the team
 * that snapped; null on a kick, without a line, or goal to go (the
 * touchdown says it then).
 */
export function firstDownFrame(prep: Prepared): number | null {
  const { firstDown, attack } = prep.scene.field;
  if (firstDown === null || firstDown >= 110 || firstDown <= 10) return null;
  const side = attack === 1 ? 'featured' : 'opponent';
  for (let f = prep.snapFrame + 1; f < prep.frames; f++) {
    const ci = prep.carrier[f];
    if (ci == null || prep.players[ci]?.side !== side) continue;
    if (attack * (prep.ball.x[f]! - firstDown) >= 0) return f;
  }
  return null;
}

/** Who caught an interception: the carrier at the moment or just after; null if the tracking never gives him the ball. */
export function interceptor(prep: Prepared): { frame: number; player: number } | null {
  const pick = prep.scene.events.find((e) => e.name === 'pass_outcome_interception');
  if (!pick) return null;
  for (let f = pick.frame; f < Math.min(prep.frames, pick.frame + 6); f++) {
    const c = prep.carrier[f];
    if (c != null) return { frame: pick.frame, player: c };
  }
  return null;
}
