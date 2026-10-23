/**
 * Build-time facts about the exported 4th down model (models/fourth-down/)
 * for the calculator's pages. Read once per build, shared by both tabs.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import manifest from '../../models/fourth-down/manifest.json';

const DIR = join(process.cwd(), 'models', 'fourth-down');

export { manifest as modelManifest };

/** What the calculator downloads, every model file gzipped as a web server sends it. */
export const modelDownloadBytes = ['manifest.json', ...Object.values(manifest.files).map((f) => f.path)].reduce(
  (sum, path) => sum + gzipSync(readFileSync(join(DIR, path))).length,
  0,
);
