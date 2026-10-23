/**
 * One live game's state in one scoreboard poll, read from ESPN's scoreboard
 * event (the live ticker's poll, never a request of its own). Every field is
 * read defensively, as in the ticker: anything missing is null.
 *
 * Field position. ESPN's `yardLine` counts from the home team's goal line
 * (checked on every scrimmage play of NE at CHI, 2026-10-22), so the yards
 * to the offense's goal line are 100 - yardLine when the home team has the
 * ball and yardLine when the visitors do. ESPN's `yardsToEndzone` is never
 * used: on both of CHI's punts that night it gave the distance from CHI's
 * own goal line instead (24 at the CHI 24).
 */
import { isObject, type Json } from '../live-ticker/json.ts';

export interface LastPlay {
  id: string;
  type: string;
  text: string;
  /** Where the play started: ESPN's yardLine (from the home goal) and the team with the ball */
  start: { yardLine: number | null; team: string | null };
}

export interface Snapshot {
  /** ISO instant the poll arrived */
  seen: string;
  event: string;
  state: 'pre' | 'in' | 'post';
  period: number;
  /** "9:40" */
  clock: string;
  homeId: string;
  awayId: string;
  homeScore: number | null;
  awayScore: number | null;
  down: number | null;
  distance: number | null;
  /** From the home team's goal line */
  yardLine: number | null;
  /** ESPN team id of the team with the ball; null between possessions */
  possession: string | null;
  homeTimeouts: number | null;
  awayTimeouts: number | null;
  lastPlay: LastPlay | null;
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number.parseInt(v, 10) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

function lastPlayOf(value: unknown): LastPlay | null {
  if (!isObject(value) || typeof value.id !== 'string') return null;
  const type = isObject(value.type) ? str(value.type.text) : null;
  const start = isObject(value.start) ? value.start : {};
  const team = isObject(start.team) ? str(start.team.id) : null;
  return {
    id: value.id,
    type: type ?? '',
    text: (str(value.text) ?? '').trim(),
    start: { yardLine: num(start.yardLine), team },
  };
}

/** A scoreboard event as a snapshot, or null when it is not shaped as expected. */
export function parseSnapshot(event: unknown, seen: string): Snapshot | null {
  if (!isObject(event) || typeof event.id !== 'string' || !isObject(event.status)) return null;
  const competition = Array.isArray(event.competitions) ? event.competitions[0] : null;
  if (!isObject(competition) || !Array.isArray(competition.competitors)) return null;
  const side = (homeAway: string): Json | undefined =>
    (competition.competitors as unknown[]).find((c): c is Json => isObject(c) && c.homeAway === homeAway);
  const home = side('home');
  const away = side('away');
  const homeId = home && isObject(home.team) ? str(home.team.id) : null;
  const awayId = away && isObject(away.team) ? str(away.team.id) : null;
  if (!home || !away || !homeId || !awayId) return null;

  const type = isObject(event.status.type) ? event.status.type : {};
  const state = type.state === 'in' || type.state === 'post' ? type.state : 'pre';
  const s: Json = isObject(competition.situation) ? competition.situation : {};
  return {
    seen,
    event: event.id,
    state,
    period: num(event.status.period) ?? 0,
    clock: str(event.status.displayClock) ?? '',
    homeId,
    awayId,
    homeScore: num(home.score),
    awayScore: num(away.score),
    down: num(s.down),
    distance: num(s.distance),
    yardLine: num(s.yardLine),
    possession: str(s.possession),
    homeTimeouts: num(s.homeTimeouts),
    awayTimeouts: num(s.awayTimeouts),
    lastPlay: lastPlayOf(s.lastPlay),
  };
}

/** Every event of a scoreboard response as snapshots. */
export function parseSnapshots(data: unknown, seen: string): Snapshot[] {
  if (!isObject(data) || !Array.isArray(data.events)) return [];
  return data.events.flatMap((event) => parseSnapshot(event, seen) ?? []);
}

/** Yards to the offense's goal line (nflfastR's yardline_100), from yardLine and possession only. */
export function yardline100(yardLine: number | null, possession: string | null, homeId: string): number | null {
  if (yardLine === null || possession === null || yardLine < 0 || yardLine > 100) return null;
  return possession === homeId ? 100 - yardLine : yardLine;
}
