/**
 * The worker's name (`new Worker(url, { name })`) for a page that shows
 * nfl4th only: the worker then skips the experimental model's files, so the
 * engine returns `experimental: 'unavailable'` without computing it. The live
 * 4th down items use it until they show the experimental model next to
 * nfl4th. Its own module so the live pages do not bundle the worker or load.ts.
 */
export const NFL4TH_ONLY = 'nfl4th-only';
