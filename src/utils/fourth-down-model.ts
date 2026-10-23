/**
 * Build-time facts about the exported 4th down model (models/fourth-down/)
 * for the calculator's pages and the home page. Read once per build.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import manifest from '../../models/fourth-down/manifest.json';
import { loadFourthDownModel, recommend, recommendTry } from '../lib/fourth-down';
import { checkFourthDown, checkTry, defaults, encode, scenarioLine } from '../lib/calculator/form';
import { fourthDownView, tryView } from '../lib/calculator/format';

const DIR = join(process.cwd(), 'models', 'fourth-down');

export { manifest as modelManifest };

/** What the calculator downloads, every model file gzipped as a web server sends it. */
export const modelDownloadBytes = ['manifest.json', ...Object.values(manifest.files).map((f) => f.path)].reduce(
  (sum, path) => sum + gzipSync(readFileSync(join(DIR, path))).length,
  0,
);

/**
 * The calculator's two default scenarios, computed at build time for the
 * home page through the page's own path (form, check, model, view), so the
 * home page shows real numbers without downloading the model. Each links to
 * its tab with the scenario in the URL. Null views when the model does not
 * load, which the panel shows as unavailable.
 */
export function homeExamples(season: number) {
  const read = (path: string) => JSON.parse(readFileSync(join(DIR, path), 'utf8'));
  const f = manifest.files;
  const loaded = loadFourthDownModel({
    manifest: read('manifest.json'),
    fdModel: read(f.fd_model.path),
    epModel: read(f.ep_model.path),
    homeWpModel: read(f.home_wp_model.path),
    wpSpreadModel: read(f.wp_spread_model.path),
    twoPtModel: read(f.two_pt_model.path),
    tables: read(f.tables.path),
    terms: read(f.terms.path),
  });
  const fallbacks = { total: manifest.fallbackTotalLine };
  const fourth = defaults('fourth-down', season);
  const after = defaults('try', season);
  const fourthSituation = checkFourthDown(fourth, season).situation;
  const trySituation = checkTry(after, season).situation;
  return {
    fourthDown: {
      line: scenarioLine(fourth, 'fourth-down'),
      path: 'fourth-down',
      query: encode(fourth, 'fourth-down'),
      view: loaded && fourthSituation ? fourthDownView(recommend(fourthSituation), fallbacks) : null,
    },
    try: {
      line: scenarioLine(after, 'try'),
      path: 'fourth-down/try',
      query: encode(after, 'try'),
      view: loaded && trySituation ? tryView(recommendTry(trySituation), fallbacks) : null,
    },
  };
}
