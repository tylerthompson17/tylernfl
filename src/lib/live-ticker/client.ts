/**
 * Live ticker in the browser: shows kickoff times in the visitor's time zone,
 * and during game windows polls ESPN's scoreboard to update scores in place.
 * One poll feeds every game on the page: the ticker slots, the rail's
 * schedule, and the boxes on the scoreboard page, which all carry the same
 * data hooks.
 * Live games move into the pinned group ahead of the strip of finished and
 * upcoming games, a changed score gets a brief highlight, and a line under
 * each pinned game says who scored last. The pinned group takes the width
 * it needs, so on a full Sunday slate the strip is squeezed out and the
 * ticker is only the games in progress. The page is fully rendered from
 * ticker.json first, so any failure here leaves that data showing.
 */

import { LIVE_TICKER_ENABLED } from '../../config.ts';
import { parseScoreboard, scoreboardUrl, type LiveGame } from './espn.ts';
import { formatKickoff } from './kickoff.ts';
import { scoreChanged, stripInsertIndex } from './pin.ts';
import { describeLastScore, matchesScore, parseLastScore, summaryUrl } from './scoring.ts';
import {
  POLL_INTERVAL_MS,
  REQUEST_TIMEOUT_MS,
  isAdvance,
  pollWindow,
  retryDelay,
  type ScheduledGame,
} from './schedule.ts';

// Longest delay setTimeout supports.
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

/**
 * Every rendered copy of a game: its ticker slot, the carousel's copy of
 * that slot, its row in the rail's schedule, and its box on the scoreboard
 * page.
 */
function slotsFor(espnId: string): NodeListOf<HTMLElement> {
  return document.querySelectorAll<HTMLElement>(`[data-game][data-espn-id="${CSS.escape(espnId)}"]`);
}

/**
 * Eastern times written at build time, rewritten in the visitor's zone: the
 * kickoff in each upcoming game that carries one (ticker slots, the rail's
 * schedule), and each kickoff heading on the scoreboard page. Scoreboard
 * boxes have no kickoff of their own; the heading above them carries it.
 */
export function localizeKickoffs(): void {
  for (const slot of document.querySelectorAll<HTMLElement>('[data-game][data-state="pre"][data-kickoff]')) {
    const text = formatKickoff(slot.dataset.kickoff!);
    const detail = slot.querySelector('[data-detail]');
    if (text && detail) detail.textContent = text;
  }
  for (const heading of document.querySelectorAll<HTMLElement>('[data-slot-label][data-kickoff]')) {
    const text = formatKickoff(heading.dataset.kickoff!);
    if (text) heading.textContent = text;
  }
}

const SCORE_CHANGED = 'score-changed';

function setScore(line: Element | null, value: number | null, live: boolean): void {
  const el = line?.querySelector<HTMLElement>('[data-score]');
  if (!el) return;
  const changed = live && scoreChanged(el.textContent ?? '', value);
  el.textContent = value == null ? '' : String(value);
  if (changed) {
    // Restart the highlight if a second score lands before the first fades.
    el.classList.remove(SCORE_CHANGED);
    void el.offsetWidth;
    el.classList.add(SCORE_CHANGED);
  }
}

/** The strip of finished and upcoming games, not its decorative copy. */
function strip(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.ticker .ticker-track:not([aria-hidden="true"])');
}

/** The pinned list the browser moves games into, not its decorative copy. */
function pinnedList(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.ticker [data-pinned]:not([aria-hidden="true"])');
}

/**
 * Pin a live game ahead of the strip, or return a finished one to the
 * strip after the other finals. Only the real slot moves; each group
 * rebuilds its carousel copy when its games change.
 *
 * An empty group is hidden so it takes no width: with no live games the
 * strip has the whole row, which is how the page is built.
 */
function place(slot: HTMLElement, state: LiveGame['state']): void {
  // Scoreboard boxes stay in kickoff order; only ticker slots move.
  if (!slot.closest('.ticker') || slot.closest('[aria-hidden="true"]')) return;
  const pinned = pinnedList();
  const track = strip();
  if (!pinned || !track) return;

  if (state === 'live' && slot.parentElement !== pinned) {
    pinned.append(slot);
  } else if (state !== 'live' && slot.parentElement === pinned) {
    const others = [...track.children] as HTMLElement[];
    const index = stripInsertIndex(others.map((el) => el.dataset.state as LiveGame['state']));
    track.insertBefore(slot, others[index] ?? null);
  }
  const group = pinned.closest<HTMLElement>('.ticker-group');
  if (group) group.hidden = pinned.children.length === 0;
}

function render(slot: HTMLElement, game: LiveGame): void {
  slot.dataset.state = game.state;

  const detail = slot.querySelector('[data-detail]');
  if (detail) {
    detail.classList.toggle('live', game.state === 'live');
    const kickoff = game.state === 'pre' && slot.dataset.kickoff ? formatKickoff(slot.dataset.kickoff) : null;
    const text = game.detail ?? kickoff;
    if (text) detail.textContent = text;
  }

  const away = slot.querySelector('[data-side="away"]');
  const home = slot.querySelector('[data-side="home"]');
  const live = game.state === 'live';
  setScore(away, game.awayScore, live);
  setScore(home, game.homeScore, live);

  const decided = game.state === 'final' && game.awayScore != null && game.homeScore != null;
  away?.classList.toggle('won', decided && game.awayScore! > game.homeScore!);
  home?.classList.toggle('won', decided && game.homeScore! > game.awayScore!);

  place(slot, game.state);
}

async function getJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    // A plain GET with no custom headers: ESPN rejects CORS preflight requests.
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`ESPN request failed: ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchScoreboard(season: number, week: number): Promise<Map<string, LiveGame>> {
  const games = parseScoreboard(await getJson(scoreboardUrl(season, week)), season, week);
  if (!games) throw new Error('Unexpected scoreboard response');
  return games;
}

// The summary can trail the scoreboard by a few seconds after a score, so a
// mismatch is retried a few times before the line is left empty.
const LAST_SCORE_RETRY_MS = [10_000, 20_000, 40_000];

interface LastScoreState {
  /** "away-home" score the line describes, or is being fetched for */
  key: string;
  attempt: number;
  timer?: number;
}

/**
 * The "who scored last" line under a pinned game. It blanks the moment the
 * score changes, so it never describes an older score, and fills once
 * ESPN's game summary lists a scoring play that matches the new score.
 *
 * The line keeps its space from kickoff to the final whistle ("No scoring
 * yet" before the first score, blank while fetching), so the ticker only
 * changes height when the pinned group appears or empties, not on every
 * score.
 *
 * Both showing and hiding write to every copy of the game: a full slate of
 * live games overflows the row, and the pinned group then runs a carousel
 * whose second copy would otherwise describe an older score.
 */
function showLastScore(eventId: string, text: string, title?: string): void {
  for (const slot of slotsFor(eventId)) {
    const line = slot.querySelector<HTMLElement>('[data-last-score]');
    if (!line) continue;
    // A no-break space keeps the row's height while the line is blank.
    line.querySelector('[data-last-score-text]')!.textContent = text || '\u00a0';
    if (title) line.title = title;
    else line.removeAttribute('title');
    line.hidden = false;
  }
}

/**
 * A game that just went final has already left the pinned group by the time
 * this runs, so this cannot look only there.
 */
function hideLastScore(eventId: string): void {
  for (const slot of slotsFor(eventId)) {
    const line = slot.querySelector<HTMLElement>('[data-last-score]');
    if (!line) continue;
    line.hidden = true;
    line.removeAttribute('title');
    line.querySelector('[data-last-score-text]')!.textContent = '';
  }
}

function createLastScoreTracker() {
  const states = new Map<string, LastScoreState>();

  async function load(eventId: string, game: LiveGame, state: LastScoreState): Promise<void> {
    let last = null;
    try {
      last = parseLastScore(await getJson(summaryUrl(eventId)));
    } catch {
      // Network trouble: treated like a summary that has not caught up.
    }
    if (states.get(eventId) !== state) return;

    if (last && matchesScore(last, game.awayScore, game.homeScore)) {
      const slot = slotsFor(eventId)[0];
      const team = slot?.querySelector<HTMLElement>(`[data-side="${last.side}"]`)?.dataset.team ?? '';
      const { line: text, title } = describeLastScore(last, team);
      showLastScore(eventId, text, title);
      return;
    }
    const delay = LAST_SCORE_RETRY_MS[state.attempt];
    if (delay === undefined) return;
    state.attempt += 1;
    state.timer = window.setTimeout(() => void load(eventId, game, state), delay);
  }

  return {
    /** Call after each poll for every game in the response. */
    update(eventId: string, game: LiveGame): void {
      const previous = states.get(eventId);
      if (game.state !== 'live') {
        if (previous) window.clearTimeout(previous.timer);
        states.delete(eventId);
        hideLastScore(eventId);
        return;
      }
      const key = `${game.awayScore ?? 0}-${game.homeScore ?? 0}`;
      if (previous?.key === key) return;
      if (previous) window.clearTimeout(previous.timer);

      const state: LastScoreState = { key, attempt: 0 };
      states.set(eventId, state);
      if (!game.awayScore && !game.homeScore) {
        showLastScore(eventId, 'No scoring yet');
        return;
      }
      showLastScore(eventId, '');
      void load(eventId, game, state);
    },
  };
}

export function initLiveTicker(): void {
  const ticker = document.querySelector<HTMLElement>('.ticker');
  if (!ticker) return;

  localizeKickoffs();
  if (!LIVE_TICKER_ENABLED) return;

  const season = Number(ticker.dataset.season);
  const week = Number(ticker.dataset.week);
  if (!season || !week) return;

  // Clear a finished highlight so a later score can replay it.
  ticker.addEventListener('animationend', (event) => {
    (event.target as HTMLElement).classList.remove(SCORE_CHANGED);
  });

  // The ticker carries every game of the week on every page, so it is the
  // schedule even when the scoreboard page is the thing being watched.
  const games = new Map<string, ScheduledGame>();
  for (const slot of ticker.querySelectorAll<HTMLElement>('.game[data-espn-id]')) {
    const id = slot.dataset.espnId!;
    if (games.has(id)) continue;
    games.set(id, {
      kickoff: slot.dataset.kickoff ? new Date(slot.dataset.kickoff) : null,
      state: slot.dataset.state as ScheduledGame['state'],
    });
  }
  if (games.size === 0) return;

  let timer: number | undefined;
  let failures = 0;
  const lastScores = createLastScoreTracker();

  const schedule = (delay: number) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(tick, Math.min(Math.max(delay, 0), MAX_TIMEOUT_MS));
  };

  async function tick() {
    if (document.hidden) return;

    const now = new Date();
    const window_ = pollWindow([...games.values()], now);
    if (!window_.active) {
      if (window_.nextStart) schedule(window_.nextStart.getTime() - now.getTime());
      return;
    }

    try {
      const live = await fetchScoreboard(season, week);
      for (const [id, game] of live) {
        const current = games.get(id);
        if (!current || !isAdvance(current.state, game.state)) continue;
        current.state = game.state;
        for (const slot of slotsFor(id)) render(slot, game);
        lastScores.update(id, game);
      }
      failures = 0;
      schedule(POLL_INTERVAL_MS);
    } catch {
      failures += 1;
      schedule(retryDelay(failures));
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) window.clearTimeout(timer);
    else schedule(0);
  });
  schedule(0);
}
