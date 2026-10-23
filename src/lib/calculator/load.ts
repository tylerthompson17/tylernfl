/**
 * Fetch the exported 4th down model (models/fourth-down/) for the
 * calculator. Each file is a content-hashed build asset (Vite's ?url), so
 * a new export is a new URL and the old one can be cached for good. Only the
 * calculator's script imports this module, so no other page carries the
 * URLs, let alone the files; astro.config.mjs keeps Vite from inlining the
 * small ones into the script.
 */
import manifestUrl from '../../../models/fourth-down/manifest.json?url';
import fdModelUrl from '../../../models/fourth-down/fd_model.json?url';
import epModelUrl from '../../../models/fourth-down/ep_model.json?url';
import homeWpModelUrl from '../../../models/fourth-down/home_wp_model.json?url';
import wpSpreadModelUrl from '../../../models/fourth-down/wp_spread_model.json?url';
import twoPtModelUrl from '../../../models/fourth-down/two_pt_model.json?url';
import tablesUrl from '../../../models/fourth-down/tables.json?url';
import termsUrl from '../../../models/fourth-down/terms.json?url';
import type { ModelFiles } from '../fourth-down.ts';

const URLS: Record<keyof ModelFiles, string> = {
  manifest: manifestUrl,
  fdModel: fdModelUrl,
  epModel: epModelUrl,
  homeWpModel: homeWpModelUrl,
  wpSpreadModel: wpSpreadModelUrl,
  twoPtModel: twoPtModelUrl,
  tables: tablesUrl,
  terms: termsUrl,
};

/** Every model file, fetched in parallel and parsed. Rejects if any fails. */
export async function fetchModelFiles(): Promise<ModelFiles> {
  const entries = await Promise.all(
    Object.entries(URLS).map(async ([key, href]) => {
      const response = await fetch(href);
      if (!response.ok) throw new Error(`${href}: ${response.status}`);
      return [key, await response.json()] as const;
    }),
  );
  return Object.fromEntries(entries) as unknown as ModelFiles;
}
