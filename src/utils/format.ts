/**
 * Formatting for values the pipelines store raw, so the JSON stays numeric
 * and the display choice lives in one place.
 */

/** Height in inches as feet-inches: 74 -> "6-2". Null when unlisted. */
export function formatHeight(inches: number | null): string | null {
  if (inches === null || inches <= 0) return null;
  return `${Math.floor(inches / 12)}-${inches % 12}`;
}

/** Completed NFL seasons. A rookie reads as R rather than 0. */
export function formatExperience(years: number | null): string | null {
  if (years === null) return null;
  return years === 0 ? 'R' : String(years);
}
