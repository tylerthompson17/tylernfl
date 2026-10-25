/**
 * The calculator's model worker (src/lib/calculator/worker.ts) for the live
 * page and the home panel: started on demand, it downloads the model once
 * (about 2.6 MB) and answers any number of situations, each by its own
 * request id. Results are cached by a key the caller chooses.
 */
import type { FourthDownResult, FourthDownSituation } from '../fourth-down.ts';
import type { WorkerMessage, WorkerRequest } from '../calculator/worker.ts';

export type ModelState = 'off' | 'loading' | 'ready' | 'failed';

export function createModel(onUpdate: () => void) {
  let state: ModelState = 'off';
  let worker: Worker | null = null;
  let nextId = 0;
  const results = new Map<string, FourthDownResult>();
  const pending = new Map<number, string>();
  const asked = new Set<string>();
  const queue: [string, FourthDownSituation][] = [];

  function send(key: string, situation: FourthDownSituation): void {
    nextId += 1;
    pending.set(nextId, key);
    const message: WorkerRequest = { id: nextId, kind: 'fourth-down', situation };
    worker!.postMessage(message);
  }

  return {
    state: () => state,
    result: (key: string) => results.get(key),

    start(): void {
      if (state !== 'off') return;
      state = 'loading';
      try {
        worker = new Worker(new URL('../calculator/worker.ts', import.meta.url), { type: 'module' });
      } catch {
        state = 'failed';
        onUpdate();
        return;
      }
      worker.addEventListener('message', (event: MessageEvent<WorkerMessage>) => {
        const message = event.data;
        if (message.type === 'ready') {
          state = message.ok ? 'ready' : 'failed';
          if (state === 'ready') for (const [key, situation] of queue.splice(0)) send(key, situation);
          onUpdate();
          return;
        }
        const key = pending.get(message.id);
        if (key === undefined) return;
        pending.delete(message.id);
        results.set(key, message.result as FourthDownResult);
        if (pending.size === 0 || pending.size % 10 === 0) onUpdate();
      });
      worker.addEventListener('error', () => {
        state = 'failed';
        onUpdate();
      });
      onUpdate();
    },

    /** Ask for a situation's numbers once per key; ready ones are in result(). */
    ask(key: string, situation: FourthDownSituation): void {
      if (asked.has(key)) return;
      asked.add(key);
      if (state === 'ready') send(key, situation);
      else queue.push([key, situation]);
    },
  };
}
