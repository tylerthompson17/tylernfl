/**
 * The home page's live 4th down panel. It reads the live ticker's poll
 * (SCOREBOARD_EVENT, no request of its own), shows the latest 4th down of
 * any live game and the play that answered it, and falls back to the
 * calculator's examples when no game is live. Win probabilities come only
 * when the visitor asks: the button starts the calculator's worker, which
 * downloads the model then (about 2.6 MB), and only while a game is live.
 * They are shown per option in a fixed order, with no verdict.
 */
import { LIVE_FOURTH_DOWN_ENABLED } from '../../config.ts';
import type { FourthDownResult } from '../fourth-down.ts';
import { SCOREBOARD_EVENT, type ScoreboardEventDetail } from '../live-ticker/espn.ts';
import type { WorkerMessage, WorkerRequest } from '../calculator/worker.ts';
import { liveWords, optionRows, situationOf, type LiveGameInfo } from './situation.ts';
import { parseSnapshots } from './snapshot.ts';
import { latest, stepAll, type GameTrack, type LiveFourthDown } from './tracker.ts';

type ModelState = 'off' | 'loading' | 'ready' | 'failed';

function setText(root: HTMLElement, hook: string, text: string): void {
  const el = root.querySelector<HTMLElement>(`[data-live="${hook}"]`);
  if (el) el.textContent = text;
}

function setUp(root: HTMLElement): void {
  let games: Record<string, LiveGameInfo> = {};
  try {
    games = JSON.parse(document.getElementById('live-fourth-games')?.textContent ?? '{}');
  } catch {
    return;
  }
  const live = root.querySelector<HTMLElement>('[data-live-section]')!;
  const examples = root.querySelector<HTMLElement>('[data-calc-examples]')!;
  const title = document.getElementById(root.dataset.titleId ?? '');
  const fallbackTitle = title?.textContent ?? '';
  const button = root.querySelector<HTMLButtonElement>('[data-live-show-wp]')!;
  const wp = root.querySelector<HTMLElement>('[data-live-wp]')!;

  let tracks = new Map<string, GameTrack>();
  let anyLive = false;
  let shown: LiveFourthDown | null = null;
  let model: ModelState = 'off';
  let worker: Worker | null = null;
  let requestId = 0;
  let resultFor = '';

  /** Identifies what the numbers are for: the 4th down and its latest pre-snap poll. */
  const keyOf = (d: LiveFourthDown) => `${d.event}|${d.firstSeen}|${d.before.seen}`;

  function showWp(content: Node[]): void {
    wp.replaceChildren(...content);
    wp.hidden = false;
  }

  function line(text: string): HTMLParagraphElement {
    const p = document.createElement('p');
    p.className = 'live-wp-note';
    p.textContent = text;
    return p;
  }

  function renderResult(result: FourthDownResult): void {
    const options = optionRows(result);
    if ('message' in options) return showWp([line(options.message)]);
    const table = document.createElement('table');
    table.className = 'stat-table';
    const caption = document.createElement('caption');
    caption.className = 'visually-hidden';
    caption.textContent = 'Win probability of each option, before the snap';
    const body = document.createElement('tbody');
    for (const row of options.rows) {
      const tr = document.createElement('tr');
      const th = document.createElement('th');
      th.scope = 'row';
      th.textContent = row.label;
      const td = document.createElement('td');
      td.className = 'number';
      td.textContent = row.value;
      tr.append(th, td);
      body.append(tr);
    }
    table.append(caption, body);
    showWp([table]);
  }

  /** Ask the worker for the shown 4th down, unless its numbers are already up. */
  function request(): void {
    if (!shown || model !== 'ready' || !worker) return;
    const key = keyOf(shown);
    if (key === resultFor) return;
    const situation = situationOf(shown, games[shown.event]);
    if (!situation) return showWp([line('The scoreboard is missing part of this situation, so there are no numbers.')]);
    requestId += 1;
    resultFor = key;
    const message: WorkerRequest = { id: requestId, kind: 'fourth-down', situation };
    worker.postMessage(message);
  }

  function render(): void {
    const d = anyLive ? latest(tracks) : null;
    shown = d && games[d.event] ? d : null;
    live.hidden = !shown;
    examples.hidden = Boolean(shown);
    if (title) title.textContent = shown ? 'Live 4th down' : fallbackTitle;
    if (!shown) return;

    const words = liveWords(shown, games[shown.event]);
    setText(live, 'game', `${words.game}, ${words.clock}. ${words.score}.`);
    setText(live, 'down', `${words.team} ${words.down}`);
    setText(live, 'timeouts', words.timeouts);
    setText(live, 'status', words.status);
    setText(live, 'play', words.play ?? '');
    button.hidden = model !== 'off';
    request();
  }

  function startModel(): void {
    if (model !== 'off' || !anyLive) return;
    model = 'loading';
    button.hidden = true;
    showWp([line('Loading the model, about 2.6 MB…')]);
    try {
      worker = new Worker(new URL('../calculator/worker.ts', import.meta.url), { type: 'module' });
    } catch {
      model = 'failed';
      return showWp([line('Win probabilities are unavailable: the model could not be loaded.')]);
    }
    worker.addEventListener('message', (event: MessageEvent<WorkerMessage>) => {
      const message = event.data;
      if (message.type === 'ready') {
        model = message.ok ? 'ready' : 'failed';
        if (!message.ok) return showWp([line('Win probabilities are unavailable: the model could not be loaded.')]);
        return request();
      }
      if (message.id === requestId) renderResult(message.result as FourthDownResult);
    });
    worker.addEventListener('error', () => {
      model = 'failed';
      showWp([line('Win probabilities are unavailable: the model could not be loaded.')]);
    });
  }

  button.addEventListener('click', startModel);
  document.addEventListener(SCOREBOARD_EVENT, (event) => {
    const { data, seen } = (event as CustomEvent<ScoreboardEventDetail>).detail;
    const snapshots = parseSnapshots(data, seen).filter((s) => s.event in games);
    tracks = stepAll(tracks, snapshots);
    anyLive = snapshots.some((s) => s.state === 'in');
    render();
  });
}

export function initLiveFourth(): void {
  // Off: nothing listens, so the panel keeps the examples it was built with.
  if (!LIVE_FOURTH_DOWN_ENABLED) return;
  document.querySelectorAll<HTMLElement>('[data-live-fourth]').forEach(setUp);
}
