/**
 * The 4th down calculator's model, off the main thread. A recommendation
 * takes about 15 ms on a desktop but 50 to 100 ms on a phone (4x CPU
 * slowdown), long enough to stall typing, and parsing the model's 10 MB of
 * JSON is worse, so both happen here. The worker fetches and loads the
 * model once, says whether it loaded, then answers each situation the page
 * sends with recommend() or recommendTry() and how long it took.
 */
import { loadFourthDownModel, recommend, recommendTry } from '../fourth-down.ts';
import type { FourthDownSituation, TrySituation } from '../fourth-down.ts';
import type { Fallbacks } from './format.ts';
import { fetchModelFiles } from './load.ts';

export type WorkerRequest =
  | { id: number; kind: 'fourth-down'; situation: FourthDownSituation }
  | { id: number; kind: 'try'; situation: TrySituation };

export type WorkerMessage =
  | { type: 'ready'; ok: boolean; fallbacks: Fallbacks | null }
  | { type: 'result'; id: number; result: ReturnType<typeof recommend> | ReturnType<typeof recommendTry>; ms: number };

const post = (message: WorkerMessage) => self.postMessage(message);

fetchModelFiles()
  .then((files) => post({ type: 'ready', ok: loadFourthDownModel(files), fallbacks: { total: files.manifest.fallbackTotalLine, kickOffset: files.manifest.kickDistanceOffset } }))
  .catch(() => post({ type: 'ready', ok: false, fallbacks: null }));

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  const start = performance.now();
  const result = request.kind === 'fourth-down' ? recommend(request.situation) : recommendTry(request.situation);
  post({ type: 'result', id: request.id, result, ms: performance.now() - start });
};
