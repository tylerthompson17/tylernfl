/**
 * The 4th down calculator's page script, for both tabs. Reads the form from
 * the URL, starts the model in a worker (worker.ts) while showing a loading
 * state, then recomputes on every change, debounced, and keeps the inputs in
 * the query string so a scenario can be shared. Everything it decides is in
 * form.ts and format.ts; this file only moves values in and out of the page.
 */
import {
  checkFourthDown,
  checkTry,
  decode,
  encode,
  fieldsOf,
  situationLine,
  yardline100Of,
  type CalculatorKind,
  type FieldErrors,
  type FormValues,
} from './form.ts';
import { fieldGoalKick, fieldStripHtml } from '../field/strip.ts';
import { fourthDownView, tryView, unsupportedView, type CalculatorView, type Fallbacks } from './format.ts';
import type { FourthDownResult, TryResult } from '../fourth-down.ts';
import type { WorkerMessage, WorkerRequest } from './worker.ts';

const DEBOUNCE_MS = 150;

type Control = HTMLInputElement | HTMLSelectElement;

function control(form: HTMLFormElement, field: string): Control | null {
  return form.elements.namedItem(field) as Control | null;
}

function readForm(form: HTMLFormElement, kind: CalculatorKind): FormValues {
  const values: FormValues = {};
  for (const field of fieldsOf(kind)) values[field] = control(form, field)?.value ?? '';
  return values;
}

function writeForm(form: HTMLFormElement, kind: CalculatorKind, values: FormValues): void {
  for (const field of fieldsOf(kind)) {
    const el = control(form, field);
    if (el) el.value = values[field] ?? '';
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** The result panel's contents for a view. */
function renderView(view: CalculatorView): Node[] {
  if (view.kind === 'unsupported') return [el('p', 'calc-unsupported', view.message)];

  const head = el('div', 'calc-call');
  head.append(el('span', 'calc-call-label', "nfl4th's recommendation"), el('strong', 'calc-call-value', view.call));
  const nodes: Node[] = [head, el('p', 'calc-margin', view.margin)];

  const grid = el('div', 'calc-options');
  for (const option of view.options) {
    const box = el('section', option.best ? 'calc-option best' : 'calc-option');
    const title = el('h3', 'calc-option-title');
    title.append(el('span', undefined, option.label), el('span', 'calc-option-wp', option.wp));
    const sub = el('p', 'calc-option-sub', option.best ? 'Win probability, best option' : 'Win probability');
    const list = el('dl', 'calc-parts');
    for (const part of option.parts) {
      const row = el('div');
      const value = el('dd', undefined, part.value);
      if (part.note) {
        value.title = part.note;
        value.tabIndex = 0;
        value.classList.add('has-note');
        value.append(el('span', 'visually-hidden', ` (${part.note})`));
      }
      row.append(el('dt', undefined, part.label), value);
      list.append(row);
    }
    box.append(title, sub, list);
    grid.append(box);
  }
  nodes.push(grid);

  if (view.skipped.length) {
    const list = el('ul', 'calc-skipped');
    for (const s of view.skipped) {
      const item = el('li');
      item.append(el('strong', undefined, `${s.label}: `), document.createTextNode(s.reason));
      list.append(item);
    }
    nodes.push(list);
  }
  for (const note of view.notes) nodes.push(el('p', 'calc-note', note));
  return nodes;
}

function setUp(root: HTMLElement): void {
  const kind = root.dataset.calculator as CalculatorKind;
  const season = Number(root.dataset.season);
  const form = root.querySelector<HTMLFormElement>('form')!;
  const output = root.querySelector<HTMLElement>('[data-calc-output]')!;
  const announce = root.querySelector<HTMLElement>('[data-calc-announce]')!;
  const situation = root.querySelector<HTMLElement>('[data-calc-situation]');
  const field = root.querySelector<HTMLElement>('[data-calc-field]');
  const kickOffset = Number(root.dataset.kickOffset);
  const kickLongest = Number(root.dataset.kickLongest);

  let state: 'loading' | 'ready' | 'failed' = 'loading';
  let fallbacks: Fallbacks | null = null;
  let firstResult = true;
  let worker: Worker | null = null;
  /** The latest request sent; an answer to an older one is dropped. */
  let latest = 0;

  writeForm(form, kind, decode(window.location.search, kind, season));

  function show(view: CalculatorView): void {
    output.replaceChildren(...renderView(view));
    output.setAttribute('aria-busy', 'false');
    announce.textContent = view.kind === 'result' ? `${view.call}. ${view.margin}` : view.message;
    if (firstResult) {
      firstResult = false;
      performance.mark('calculator:first-result');
    }
  }

  function update(): void {
    const values = readForm(form, kind);
    const query = encode(values, kind);
    if (query !== window.location.search) history.replaceState(null, '', `${window.location.pathname}${query}`);
    const line = situationLine(values);
    if (situation) situation.textContent = line ?? '';
    if (field) {
      field.hidden = line === null;
      if (line !== null) {
        const yardline100 = yardline100Of(values.side, Number(values.yl));
        const kick = fieldGoalKick(yardline100, kickOffset, kickLongest);
        field.innerHTML = fieldStripHtml({ yardline100, distance: Number(values.togo), kick, label: line });
      }
    }

    let request: WorkerRequest | null = null;
    let errors: FieldErrors;
    if (kind === 'fourth-down') {
      const checked = checkFourthDown(values, season);
      errors = checked.errors;
      if (checked.situation) request = { id: latest + 1, kind, situation: checked.situation };
    } else {
      const checked = checkTry(values, season);
      errors = checked.errors;
      if (checked.situation) request = { id: latest + 1, kind, situation: checked.situation };
    }
    for (const field of fieldsOf(kind)) {
      const message = errors[field];
      const input = control(form, field);
      const error = root.querySelector<HTMLElement>(`[data-error-for="${field}"]`);
      if (input) input.toggleAttribute('aria-invalid', Boolean(message));
      if (error) {
        error.textContent = message ?? '';
        error.hidden = !message;
      }
    }

    if (state === 'loading') return;
    latest += 1;
    if (state === 'failed' || !worker) show(unsupportedView('unavailable'));
    else if (!request) show({ kind: 'unsupported', message: 'Fix the marked inputs to see the numbers.' });
    else worker.postMessage(request);
  }

  function receive(message: WorkerMessage): void {
    if (message.type === 'ready') {
      performance.mark('calculator:model-loaded');
      state = message.ok ? 'ready' : 'failed';
      fallbacks = message.fallbacks;
      update();
      return;
    }
    if (message.id !== latest || !fallbacks) return;
    performance.measure('calculator:recommend', { start: 0, duration: message.ms });
    show(
      kind === 'fourth-down'
        ? fourthDownView(message.result as FourthDownResult, fallbacks)
        : tryView(message.result as TryResult, fallbacks),
    );
  }

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
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (event: MessageEvent<WorkerMessage>) => receive(event.data));
    worker.addEventListener('error', () => {
      state = 'failed';
      update();
    });
  } catch {
    state = 'failed';
    update();
  }
}

export function initCalculator(): void {
  document.querySelectorAll<HTMLElement>('[data-calculator]').forEach(setUp);
}
