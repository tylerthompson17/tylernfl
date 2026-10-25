/**
 * Paging the home panel's 4th downs, newest first, three at a time. The
 * newest page follows new plays; an older page stays on the 4th downs it
 * shows (anchored on its first one) as newer ones arrive above it.
 */
export interface Page {
  /** Index of the first item shown */
  start: number;
  /** "4 to 6 of 14" */
  label: string;
  hasNewer: boolean;
  hasOlder: boolean;
}

export function pageOf(ids: string[], anchor: string | null, size: number): Page {
  const found = anchor === null ? -1 : ids.indexOf(anchor);
  const start = found < 0 ? 0 : found;
  const end = Math.min(start + size, ids.length);
  return {
    start,
    label: ids.length === 0 ? '' : `${start + 1} to ${end} of ${ids.length}`,
    hasNewer: start > 0,
    hasOlder: end < ids.length,
  };
}

/** The anchor for the page `step` pages away (+1 older, -1 newer); null is the newest page. */
export function step(ids: string[], page: Page, size: number, direction: 1 | -1): string | null {
  const start = Math.max(0, Math.min(page.start + direction * size, Math.max(0, ids.length - 1)));
  return start === 0 ? null : ids[start];
}
