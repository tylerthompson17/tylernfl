/**
 * Finds live 4th downs in the ticker's polls and the play that answered
 * each, one game at a time, from snapshots (snapshot.ts) and nothing else.
 *
 * - A 4th down starts when a poll shows down 4 with the ball and a spot.
 * - It stays pending through timeouts, official timeouts, the two-minute
 *   warning and the end of a quarter, and through a penalty that leaves it
 *   4th down for the same team (a pre-snap foul, or a play wiped out): each
 *   later poll that still shows 4th down refreshes the situation, so a false
 *   start moves the distance and a timeout the timeouts.
 * - It is answered by the first other play ESPN reports, if that play starts
 *   where the 4th down was (same team with the ball, same spot). ESPN's last
 *   play can skip a play between polls; then the play reported starts
 *   somewhere else and the outcome is "not seen". Nothing is inferred from
 *   later states (a change of possession, a new score).
 *
 * Checked against NE at CHI (2026-10-22), polled every 10 seconds: all eight
 * 4th downs, through a timeout, a false start and the end of the 3rd quarter
 * (tests/fixtures/espn/live-fourth-401873010.json).
 */
import type { LastPlay, Snapshot } from './snapshot.ts';

export type TeamCall = 'go' | 'punt' | 'field goal';

export type Outcome =
  | { kind: 'pending' }
  | { kind: 'played'; play: LastPlay; call: TeamCall | null; fake: boolean }
  | { kind: 'not seen'; next: LastPlay | null };

export interface LiveFourthDown {
  event: string;
  /** When a poll first showed it */
  firstSeen: string;
  /** The latest poll that showed it, before the snap: its spot, distance, clock, score, timeouts */
  before: Snapshot;
  outcome: Outcome;
}

export interface GameTrack {
  current: LiveFourthDown | null;
  /** ESPN's last play id as of the last poll, so a new one can be told apart */
  lastPlayId: string | null;
}

/** Stoppages that are not a snap: the 4th down is still to be played. */
const STOPPAGES = new Set(['Timeout', 'Official Timeout', 'Two-minute warning', 'End Period', 'End of Half']);

const FAKE = /(punt|field goal) formation/i;

/** A snapshot that shows a 4th down with everything needed to describe it. */
export function isFourthDown(s: Snapshot): boolean {
  return (
    s.state === 'in' &&
    s.down === 4 &&
    s.possession !== null &&
    s.yardLine !== null &&
    s.distance !== null &&
    s.distance > 0
  );
}

/** What the team did, from the play that answered the 4th down. */
export function callOf(play: LastPlay): { call: TeamCall | null; fake: boolean } {
  const type = play.type.toLowerCase();
  const text = play.text;
  if (type.includes('punt')) return { call: 'punt', fake: false };
  if (type.includes('field goal')) return { call: 'field goal', fake: false };
  if (type === 'penalty') {
    // A penalty that ended the 4th down (accepted, a new series): the text
    // says which play it was called on, when there was one.
    if (/\bpunts\b/i.test(text)) return { call: 'punt', fake: false };
    if (/field goal is/i.test(text)) return { call: 'field goal', fake: false };
    if (/\b(pass|sacked|scrambles|up the middle|left end|right end|left tackle|right tackle|left guard|right guard)\b/i.test(text)) {
      return { call: 'go', fake: FAKE.test(text) };
    }
    return { call: null, fake: false };
  }
  if (type === 'kickoff' || type.startsWith('end of')) return { call: null, fake: false };
  return { call: 'go', fake: FAKE.test(text) };
}

const startsAt = (play: LastPlay, before: Snapshot) =>
  play.start.team === before.possession && play.start.yardLine === before.yardLine;

/** The game's track after one more poll. Pure: returns a new track. */
export function step(track: GameTrack, s: Snapshot): GameTrack {
  const lastId = s.lastPlay?.id ?? null;
  const fresh = lastId !== null && lastId !== track.lastPlayId;
  const pending = track.current?.outcome.kind === 'pending' ? track.current : null;

  if (pending) {
    if (fresh) {
      const play = s.lastPlay!;
      const stillFourth = isFourthDown(s) && s.possession === pending.before.possession;
      if (STOPPAGES.has(play.type) || (play.type === 'Penalty' && stillFourth)) {
        return { lastPlayId: lastId, current: stillFourth ? { ...pending, before: s } : pending };
      }
      const outcome: Outcome = startsAt(play, pending.before)
        ? { kind: 'played', play, ...callOf(play) }
        : { kind: 'not seen', next: play };
      return { lastPlayId: lastId, current: { ...pending, outcome } };
    }
    if (s.state === 'post') return { lastPlayId: lastId, current: { ...pending, outcome: { kind: 'not seen', next: null } } };
    // No new play yet: the clock, score or timeouts may still have moved.
    const refreshed = isFourthDown(s) && s.possession === pending.before.possession ? { ...pending, before: s } : pending;
    return { lastPlayId: lastId, current: refreshed };
  }

  // A new 4th down, unless the scoreboard has not caught up with the play
  // that answered the last one (same team, that play still the last).
  const answered = track.current?.outcome;
  const stale =
    answered?.kind === 'played' && answered.play.id === lastId && s.possession === track.current!.before.possession;
  if (isFourthDown(s) && !stale) {
    return { lastPlayId: lastId, current: { event: s.event, firstSeen: s.seen, before: s, outcome: { kind: 'pending' } } };
  }
  return { lastPlayId: lastId, current: track.current };
}

/**
 * Every game's track after a poll. A game's first poll only notes ESPN's
 * last play, so a 4th down already answered before the page loaded is not
 * mistaken for one still to come.
 */
export function stepAll(tracks: Map<string, GameTrack>, snapshots: Snapshot[]): Map<string, GameTrack> {
  const next = new Map(tracks);
  for (const s of snapshots) {
    const track = next.get(s.event);
    next.set(s.event, step(track ?? { current: null, lastPlayId: s.lastPlay?.id ?? null }, s));
  }
  return next;
}

/** The most recent 4th down across every game: the one a poll first showed last. */
export function latest(tracks: Map<string, GameTrack>): LiveFourthDown | null {
  let best: LiveFourthDown | null = null;
  for (const { current } of tracks.values()) {
    if (current && (!best || current.firstSeen > best.firstSeen)) best = current;
  }
  return best;
}
