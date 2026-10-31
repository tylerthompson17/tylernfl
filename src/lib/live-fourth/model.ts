/**
 * The calculator's model worker (src/lib/calculator/worker.ts) for the live
 * page, the home panel and team pages: started on demand, it downloads the
 * model once (about 2.6 MB) and answers any number of situations, each by
 * its own request id. Results are cached by a key the caller chooses.
 *
 * Two workers, so nfl4th's numbers come first and tt4th's fill in after:
 * a fast one that runs nfl4th only (NFL4TH_ONLY, the experimental files
 * skipped) and, once it is ready, a full one whose results carry tt4th
 * too. On a 4x slower phone a Sunday's 107 items took 4.8 s with nfl4th
 * alone and 11.6 s with both. Each answers in the order asked, which is
 * the items' order, newest first. The browser caches the shared files, so
 * the second worker downloads only tt4th's own.
 */
import type { FourthDownResult, FourthDownSituation } from '../fourth-down.ts';
import type { WorkerMessage, WorkerRequest } from '../calculator/worker.ts';
import { NFL4TH_ONLY } from '../calculator/worker-name.ts';

export type ModelState = 'off' | 'loading' | 'ready' | 'failed';

interface Lane {
  state: ModelState;
  worker: Worker | null;
  results: Map<string, FourthDownResult>;
  pending: Map<number, string>;
  queue: [string, FourthDownSituation][];
}

const lane = (): Lane => ({ state: 'off', worker: null, results: new Map(), pending: new Map(), queue: [] });

export function createModel(onUpdate: () => void) {
  let nextId = 0;
  const fast = lane();
  const full = lane();
  const asked = new Set<string>();

  function send(l: Lane, key: string, situation: FourthDownSituation): void {
    nextId += 1;
    l.pending.set(nextId, key);
    const message: WorkerRequest = { id: nextId, kind: 'fourth-down', situation };
    l.worker!.postMessage(message);
  }

  function open(l: Lane, name: string | undefined, onReady: () => void): void {
    l.state = 'loading';
    try {
      l.worker = new Worker(new URL('../calculator/worker.ts', import.meta.url), { type: 'module', name });
    } catch {
      l.state = 'failed';
      onUpdate();
      return;
    }
    l.worker.addEventListener('message', (event: MessageEvent<WorkerMessage>) => {
      const message = event.data;
      if (message.type === 'ready') {
        l.state = message.ok ? 'ready' : 'failed';
        if (l.state === 'ready') for (const [key, situation] of l.queue.splice(0)) send(l, key, situation);
        onReady();
        onUpdate();
        return;
      }
      const key = l.pending.get(message.id);
      if (key === undefined) return;
      l.pending.delete(message.id);
      l.results.set(key, message.result as FourthDownResult);
      if (l.pending.size === 0 || l.pending.size % 10 === 0) onUpdate();
    });
    l.worker.addEventListener('error', () => {
      l.state = 'failed';
      onUpdate();
    });
  }

  function ask(l: Lane, key: string, situation: FourthDownSituation): void {
    if (l.state === 'ready') send(l, key, situation);
    else if (l.state !== 'failed') l.queue.push([key, situation]);
  }

  return {
    /** nfl4th's worker */
    state: () => fast.state,
    /** nfl4th's numbers (and tt4th's, once the full worker has answered) */
    result: (key: string) => full.results.get(key) ?? fast.results.get(key),
    /** The full worker, for tt4th */
    tt4thState: () => full.state,
    /** A result with tt4th's numbers, or undefined until the full worker answers */
    tt4thResult: (key: string) => full.results.get(key),

    start(): void {
      if (fast.state !== 'off') return;
      // The full worker starts once nfl4th's is ready, so it never delays nfl4th's numbers.
      open(fast, NFL4TH_ONLY, () => {
        if (full.state === 'off') open(full, undefined, () => {});
      });
      onUpdate();
    },

    /** Ask for a situation's numbers once per key; ready ones are in result() and tt4thResult(). */
    ask(key: string, situation: FourthDownSituation): void {
      if (asked.has(key)) return;
      asked.add(key);
      ask(fast, key, situation);
      ask(full, key, situation);
    },
  };
}
