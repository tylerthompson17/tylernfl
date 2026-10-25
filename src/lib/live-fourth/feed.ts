/**
 * Today's 4th downs, from ESPN's game summaries, for the live page and the
 * home panel. The summary is the source of truth; the live ticker's
 * scoreboard poll (SCOREBOARD_EVENT, every 30 seconds) is only the trigger:
 * - on start, each of today's games that has kicked off gets its summary
 *   fetched once;
 * - after that, a game's summary is fetched again only when a poll shows
 *   that game's last play changed. One fetch per game at a time; a change
 *   during a fetch queues exactly one more. Never on a timer.
 * Every 4th down is keyed by ESPN's play id, so a refetch never duplicates
 * one. The scoreboard's timeouts are kept for any 4th down the page saw
 * live (tracker.ts), since the summary does not carry them.
 */
import { siteNow } from '../../utils/now.ts';
import { SCOREBOARD_EVENT, type ScoreboardEventDetail } from '../live-ticker/espn.ts';
import { summaryUrl } from '../live-ticker/scoring.ts';
import type { Timeouts } from './grade.ts';
import type { LiveGameInfo } from './situation.ts';
import { parseSnapshots } from './snapshot.ts';
import { parseSummary, type SummaryFourthDown } from './summary.ts';
import { stepAll, type GameTrack, type LiveFourthDown } from './tracker.ts';

export interface FeedGame extends LiveGameInfo {
  /** ISO kickoff, UTC */
  kickoff: string | null;
}

export interface FeedEntry {
  event: string;
  game: FeedGame;
  homeId: string;
  play: SummaryFourthDown;
  /** The scoreboard's, when the page saw this 4th down live; else null (counted from the summary) */
  timeouts: Timeouts | null;
  /** The game is over */
  final: boolean;
}

/** A 4th down the scoreboard shows now, not yet snapped (tracker.ts). */
export interface PendingFourthDown {
  event: string;
  game: FeedGame;
  down: LiveFourthDown;
}

export interface FeedState {
  entries: FeedEntry[];
  /** 4th downs waiting for the snap in today's live games, from the scoreboard */
  pending: PendingFourthDown[];
  /** Any of today's games live in the latest poll */
  anyLive: boolean;
  /**
   * A game day still on: a game of today's has kicked off and not every game
   * today is final (between games too). From today's kickoffs and each
   * game's final status (its summary or the poll), so it holds without a poll.
   */
  gameDay: boolean;
  /** Games whose summary has loaded at least once */
  loaded: number;
  /** Games today that have kicked off */
  started: number;
  /** Games whose last summary request failed */
  failed: number;
}

const REQUEST_TIMEOUT_MS = 10_000;

const easternDay = (d: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

/** Today's games (Eastern date of kickoff), kicked off or not. */
export function todaysGames(games: Record<string, FeedGame>, now: Date): string[] {
  const today = easternDay(now);
  return Object.entries(games)
    .filter(([, g]) => g.kickoff && easternDay(new Date(g.kickoff)) === today)
    .map(([id]) => id);
}

/** Today's games (Eastern date of kickoff) that have kicked off by `now`. */
export function startedToday(games: Record<string, FeedGame>, now: Date): string[] {
  const today = easternDay(now);
  return Object.entries(games)
    .filter(([, g]) => g.kickoff && Date.parse(g.kickoff) <= now.getTime() && easternDay(new Date(g.kickoff)) === today)
    .map(([id]) => id);
}

export function createFeed(games: Record<string, FeedGame>, onChange: (state: FeedState) => void) {
  const plays = new Map<string, Map<string, SummaryFourthDown>>();
  const homeIds = new Map<string, string>();
  const lastPlay = new Map<string, string | null>();
  const inFlight = new Set<string>();
  const again = new Set<string>();
  const failed = new Set<string>();
  const timeouts = new Map<string, Timeouts>();
  let tracks = new Map<string, GameTrack>();
  let anyLive = false;
  const finals = new Set<string>();
  let pending: PendingFourthDown[] = [];
  let started = false;

  function emit(): void {
    const entries: FeedEntry[] = [];
    for (const [event, byId] of plays) {
      const homeId = homeIds.get(event)!;
      for (const play of byId.values()) {
        entries.push({ event, game: games[event], homeId, play, timeouts: timeouts.get(play.id) ?? null, final: finals.has(event) });
      }
    }
    const now = siteNow();
    const gameDay = startedToday(games, now).length > 0 && todaysGames(games, now).some((id) => !finals.has(id));
    onChange({ entries, pending, anyLive, gameDay, loaded: plays.size, started: startedToday(games, siteNow()).length, failed: failed.size });
  }

  async function fetchSummary(event: string): Promise<void> {
    if (inFlight.has(event)) {
      again.add(event);
      return;
    }
    inFlight.add(event);
    try {
      // A plain GET with no custom headers: ESPN rejects CORS preflight requests.
      const response = await fetch(summaryUrl(event), { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (!response.ok) throw new Error(String(response.status));
      const game = parseSummary(await response.json(), event);
      if (!game) throw new Error('unexpected summary');
      homeIds.set(event, game.homeId);
      if (game.final) finals.add(event);
      const byId = plays.get(event) ?? new Map<string, SummaryFourthDown>();
      for (const play of game.fourthDowns) byId.set(play.id, play);
      plays.set(event, byId);
      failed.delete(event);
    } catch {
      failed.add(event);
    } finally {
      inFlight.delete(event);
      emit();
      if (again.delete(event)) void fetchSummary(event);
    }
  }

  function onScoreboard(event: Event): void {
    const { data, seen } = (event as CustomEvent<ScoreboardEventDetail>).detail;
    const snapshots = parseSnapshots(data, seen).filter((s) => s.event in games);
    anyLive = snapshots.some((s) => s.state === 'in');
    for (const s of snapshots) if (s.state === 'post') finals.add(s.event);

    // The scoreboard's timeouts for 4th downs seen live, by the play that answered them.
    tracks = stepAll(tracks, snapshots);
    const liveNow = new Set(snapshots.filter((s) => s.state === 'in').map((s) => s.event));
    pending = [...tracks]
      .filter(([event, t]) => liveNow.has(event) && t.current?.outcome.kind === 'pending')
      .map(([event, t]) => ({ event, game: games[event], down: t.current! }));
    for (const [, track] of tracks) {
      const d = track.current;
      if (d?.outcome.kind !== 'played') continue;
      const home = d.before.possession === d.before.homeId;
      const off = home ? d.before.homeTimeouts : d.before.awayTimeouts;
      const def = home ? d.before.awayTimeouts : d.before.homeTimeouts;
      if (off !== null && def !== null) timeouts.set(d.outcome.play.id, { offense: off, defense: def });
    }

    if (started) {
      // Only today's games: the week's scoreboard also carries earlier finals.
      const today = new Set(startedToday(games, siteNow()));
      for (const s of snapshots) {
        if (!today.has(s.event) && s.state !== 'in') continue;
        const id = s.lastPlay?.id ?? null;
        // A game's first poll only notes its last play when start() already
        // fetched it; a game not fetched yet (kicked off since) is fetched.
        const fetched = plays.has(s.event) || inFlight.has(s.event);
        const changed = lastPlay.has(s.event) ? lastPlay.get(s.event) !== id : !fetched && s.state !== 'pre';
        lastPlay.set(s.event, id);
        // A game that kicked off after the page loaded joins on its first live poll.
        if (changed && s.state !== 'pre') void fetchSummary(s.event);
      }
    }
    emit();
  }

  document.addEventListener(SCOREBOARD_EVENT, onScoreboard);
  // A first state from today's kickoffs alone, before any poll arrives.
  queueMicrotask(emit);

  return {
    /** Fetch today's started games once, then follow the poll. Idempotent. */
    start(): void {
      if (started) return;
      started = true;
      for (const event of startedToday(games, siteNow())) void fetchSummary(event);
      emit();
    },
    isLive: () => anyLive,
  };
}
