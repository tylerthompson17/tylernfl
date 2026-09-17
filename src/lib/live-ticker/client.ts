/**
 * Live ticker in the browser: shows kickoff times in the visitor's time zone,
 * and during game windows polls ESPN's scoreboard to update scores in place.
 * The page is fully rendered from ticker.json first, so any failure here
 * leaves that data showing.
 */

import { LIVE_TICKER_ENABLED } from '../../config.ts';
import { parseScoreboard, scoreboardUrl, type LiveGame } from './espn.ts';
import { formatKickoff } from './kickoff.ts';
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

/** Every rendered copy of a game (the carousel duplicates the track). */
function slotsFor(espnId: string): NodeListOf<HTMLElement> {
  return document.querySelectorAll<HTMLElement>(`.ticker .game[data-espn-id="${CSS.escape(espnId)}"]`);
}

export function localizeKickoffs(): void {
  for (const slot of document.querySelectorAll<HTMLElement>('.ticker .game[data-state="pre"][data-kickoff]')) {
    const text = formatKickoff(slot.dataset.kickoff!);
    const detail = slot.querySelector('[data-detail]');
    if (text && detail) detail.textContent = text;
  }
}

function setScore(line: Element | null, value: number | null): void {
  const el = line?.querySelector('[data-score]');
  if (el) el.textContent = value == null ? '' : String(value);
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
  setScore(away, game.awayScore);
  setScore(home, game.homeScore);

  const decided = game.state === 'final' && game.awayScore != null && game.homeScore != null;
  away?.classList.toggle('won', decided && game.awayScore! > game.homeScore!);
  home?.classList.toggle('won', decided && game.homeScore! > game.awayScore!);
}

async function fetchScoreboard(season: number, week: number): Promise<Map<string, LiveGame>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    // A plain GET with no custom headers: ESPN rejects CORS preflight requests.
    const response = await fetch(scoreboardUrl(season, week), { signal: controller.signal });
    if (!response.ok) throw new Error(`Scoreboard request failed: ${response.status}`);
    const games = parseScoreboard(await response.json(), season, week);
    if (!games) throw new Error('Unexpected scoreboard response');
    return games;
  } finally {
    clearTimeout(timeout);
  }
}

export function initLiveTicker(): void {
  const ticker = document.querySelector<HTMLElement>('.ticker');
  if (!ticker) return;

  localizeKickoffs();
  if (!LIVE_TICKER_ENABLED) return;

  const season = Number(ticker.dataset.season);
  const week = Number(ticker.dataset.week);
  if (!season || !week) return;

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
