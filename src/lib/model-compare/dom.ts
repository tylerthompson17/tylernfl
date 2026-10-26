/**
 * The experimental calculator's page script (/fourth-down/experimental/).
 * Like the 4th down calculator's (calculator/dom.ts): reads the form from
 * the URL, starts the model in the calculator's worker with the
 * experimental files, recomputes 150 ms after the last change and keeps the
 * inputs in the query string. It draws the comparison and breakdown with
 * html.ts, the same markup the week's list has from the build. It also runs
 * the list's disagreement filter and its "Load into the calculator" buttons.
 */
import { checkFourthDown, decode, encode, fieldsOf, situationLine, yardline100Of, type FormValues } from '../calculator/form.ts';
import { fieldGoalKick, fieldStripHtml } from '../field/strip.ts';
import type { FourthDownResult } from '../fourth-down.ts';
import type { WorkerMessage, WorkerRequest } from '../calculator/worker.ts';
import { checkTeams, decodeTeams, encodeTeams, TEAM_FIELDS, withTeams, type TeamValues } from './form.ts';
import { breakdownHtml, comparisonHtml } from './html.ts';
import { defaultPunterLabel, type PunterMenu } from './punters.ts';
import { breakdownView, comparisonView, unsupportedComparison, type ComparisonView } from './view.ts';

const DEBOUNCE_MS = 150;
const KIND = 'fourth-down';

type Control = HTMLInputElement | HTMLSelectElement;

function setUpCalculator(root: HTMLElement): (values: FormValues & TeamValues) => void {
  const season = Number(root.dataset.season);
  const kickOffset = Number(root.dataset.kickOffset);
  const kickLongest = Number(root.dataset.kickLongest);
  const tablesSeason = Number(root.dataset.tablesSeason);
  const menu = JSON.parse(root.querySelector('[data-punter-menu]')!.textContent!) as PunterMenu;
  const teams = Object.keys(menu.team);
  const punters = new Set([...menu.current, ...menu.others].map((p) => p.id));

  const form = root.querySelector<HTMLFormElement>('form')!;
  const output = root.querySelector<HTMLElement>('[data-calc-output]')!;
  const announce = root.querySelector<HTMLElement>('[data-calc-announce]')!;
  const situation = root.querySelector<HTMLElement>('[data-calc-situation]')!;
  const field = root.querySelector<HTMLElement>('[data-calc-field]')!;
  const defaultPunter = root.querySelector<HTMLOptionElement>('[data-default-punter]')!;
  const control = (name: string) => form.elements.namedItem(name) as Control | null;

  let state: 'loading' | 'ready' | 'failed' = 'loading';
  let worker: Worker | null = null;
  let latest = 0;
  let teamValues: TeamValues;

  function readForm(): { values: FormValues; teams: TeamValues } {
    const values: FormValues = {};
    for (const f of fieldsOf(KIND)) values[f] = control(f)?.value ?? '';
    const t = Object.fromEntries(TEAM_FIELDS.map((f) => [f, control(f)?.value ?? ''])) as unknown as TeamValues;
    return { values, teams: t };
  }

  function writeForm(values: FormValues, t: TeamValues): void {
    for (const f of fieldsOf(KIND)) {
      const c = control(f);
      if (c) c.value = values[f] ?? '';
    }
    for (const f of TEAM_FIELDS) {
      const c = control(f);
      if (c) c.value = t[f];
    }
  }

  function setError(name: string, message: string | undefined | null): void {
    control(name)?.toggleAttribute('aria-invalid', Boolean(message));
    const error = root.querySelector<HTMLElement>(`[data-error-for="${name}"]`);
    if (error) {
      error.textContent = message ?? '';
      error.hidden = !message;
    }
  }

  function show(view: ComparisonView, breakdown: string): void {
    output.innerHTML = comparisonHtml(view) + breakdown;
    output.setAttribute('aria-busy', 'false');
    announce.textContent =
      view.kind === 'both'
        ? `Experimental model: ${view.experimental.call}. nfl4th: ${view.nfl4th.call}.${view.disagree ? ' The models disagree.' : ''}`
        : view.kind === 'nfl4th-only'
          ? `nfl4th: ${view.nfl4th.call}. ${view.message}`
          : view.message;
  }

  function update(): void {
    const { values, teams: t } = readForm();
    teamValues = t;
    defaultPunter.textContent = defaultPunterLabel(menu, t.offense);
    const query = encodeTeams(encode(values, KIND), t);
    if (query !== window.location.search) history.replaceState(null, '', `${window.location.pathname}${query}${window.location.hash}`);

    const line = situationLine(values);
    situation.textContent = line ?? '';
    field.hidden = line === null;
    if (line !== null) {
      const yardline100 = yardline100Of(values.side, Number(values.yl));
      field.innerHTML = fieldStripHtml({
        yardline100,
        distance: Number(values.togo),
        kick: fieldGoalKick(yardline100, kickOffset, kickLongest),
        label: line,
      });
    }

    const checked = checkFourthDown(values, season);
    for (const f of fieldsOf(KIND)) setError(f, checked.errors[f]);
    const teamError = checkTeams(t);
    setError('defense', teamError);

    if (state === 'loading') return;
    latest += 1;
    if (state === 'failed' || !worker) show(unsupportedComparison('unavailable'), '');
    else if (!checked.situation || teamError) show({ kind: 'unsupported', message: 'Fix the marked inputs to see the numbers.' }, '');
    else {
      const request: WorkerRequest = { id: latest, kind: KIND, situation: withTeams(checked.situation, t) };
      worker.postMessage(request);
    }
  }

  function receive(message: WorkerMessage): void {
    if (message.type === 'ready') {
      state = message.ok ? 'ready' : 'failed';
      update();
      return;
    }
    if (message.id !== latest) return;
    const result = message.result as FourthDownResult;
    if (!result.supported) return show(unsupportedComparison(result.reason), '');
    const view = comparisonView(result, { team: teamValues.offense, kickOffset, tablesSeason });
    const e = result.experimental;
    show(view, e.supported ? breakdownHtml(breakdownView(e, result, kickOffset)) : '');
  }

  writeForm(decode(window.location.search, KIND, season), decodeTeams(window.location.search, teams, punters));

  let timer: ReturnType<typeof setTimeout> | undefined;
  form.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(update, DEBOUNCE_MS);
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    clearTimeout(timer);
    update();
  });
  update();

  try {
    worker = new Worker(new URL('../calculator/worker.ts', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (event: MessageEvent<WorkerMessage>) => receive(event.data));
    worker.addEventListener('error', () => {
      state = 'failed';
      update();
    });
  } catch {
    state = 'failed';
    update();
  }

  return (values) => {
    // A stored punter the menus lack (not in either table) falls back to the team's.
    writeForm(values, { ...values, punter: punters.has(values.punter) ? values.punter : '' });
    clearTimeout(timer);
    update();
  };
}

function setUpList(list: HTMLElement, load: ((values: FormValues & TeamValues) => void) | null): void {
  const toggle = list.querySelector<HTMLInputElement>('[data-disagree-filter]');
  const shown = list.querySelector<HTMLElement>('[data-shown]');
  const items = [...list.querySelectorAll<HTMLElement>('[data-item]')];
  const empty = list.querySelector<HTMLElement>('[data-filter-empty]');
  const apply = () => {
    const only = toggle?.checked ?? false;
    let n = 0;
    for (const item of items) {
      item.hidden = only && !('disagree' in item.dataset);
      if (!item.hidden) n += 1;
    }
    if (shown) shown.textContent = only ? `Showing the ${n} where they disagree.` : '';
    if (empty) empty.hidden = n > 0;
  };
  toggle?.addEventListener('change', apply);
  apply();

  const target = document.getElementById('calculator');
  list.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-load]');
    if (!button || !load) return;
    load(JSON.parse(button.dataset.load!));
    target?.scrollIntoView({ block: 'start' });
    target?.focus({ preventScroll: true });
  });
}

export function initExperimental(): void {
  const root = document.querySelector<HTMLElement>('[data-experimental-calculator]');
  const load = root ? setUpCalculator(root) : null;
  const list = document.querySelector<HTMLElement>('[data-experimental-list]');
  if (list) setUpList(list, load);
}
