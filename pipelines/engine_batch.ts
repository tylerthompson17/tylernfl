/**
 * The 4th down engine for the pipelines: the same recommend() and
 * recommendTry() the site runs (src/lib/fourth-down.ts, nfl4th through the
 * generated engine), in one Node process per pipeline run, so the grades and
 * the calculator can never disagree. Called by engine.py, never by hand.
 *
 * stdin: one JSON request per line, {"id": ..., "kind": "fourth-down" | "try", "situation": {...}}.
 * stdout: one line per request, in the same order, {"id": ..., "result": {...}}.
 * The first line out is {"modelVersion": ..., "loaded": true|false}; when
 * the model does not load every result is 'unavailable', as on the site.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

import { loadFourthDownModel, recommend, recommendTry, type ModelFiles } from '../src/lib/fourth-down.ts';

const DIR = join(import.meta.dirname, '..', 'models', 'fourth-down');
const read = (file: string) => JSON.parse(readFileSync(join(DIR, file), 'utf8'));

const manifest = read('manifest.json');
const path = (key: string): string => manifest.files[key].path;
const files: ModelFiles = {
  manifest,
  fdModel: read(path('fd_model')),
  epModel: read(path('ep_model')),
  homeWpModel: read(path('home_wp_model')),
  wpSpreadModel: read(path('wp_spread_model')),
  twoPtModel: read(path('two_pt_model')),
  tables: read(path('tables')),
  terms: read(path('terms')),
};
const loaded = loadFourthDownModel(files);
process.stdout.write(`${JSON.stringify({ modelVersion: manifest.modelVersion, loaded })}\n`);

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of lines) {
  if (!line.trim()) continue;
  const request = JSON.parse(line);
  const result = request.kind === 'try' ? recommendTry(request.situation) : recommend(request.situation);
  process.stdout.write(`${JSON.stringify({ id: request.id, result })}\n`);
}
