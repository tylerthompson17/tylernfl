/**
 * Where a team's logo lives. The filename carries a hash of the picture
 * (pipelines/build_logos.py writes it, src/data/logos.json maps it), so a
 * new logo is a new URL: a deploy replaces it everywhere at once instead
 * of waiting out the 10 minutes GitHub Pages lets a browser keep a file.
 * The generation before is kept on disk, so a page cached across that
 * deploy still finds the name it asks for.
 */
import logos from '../data/logos.json';
import type { LogosData } from '../data/types';
import { url } from './url';

export function logoUrl(abbr: string): string {
  const file = (logos as LogosData)[abbr];
  if (!file) throw new Error(`No logo for ${abbr}. Run python pipelines/build_logos.py`);
  return url(`logos/${file}`);
}
