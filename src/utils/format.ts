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

/**
 * A stat value in the format its data file names. Negative numbers use a
 * true minus sign so signed columns line up. Null reads as a dash.
 */
export function formatStat(value: number | null, format: 'signed3' | 'percent1'): string {
  if (value === null) return '-';
  if (format === 'percent1') return `${(value * 100).toFixed(1)}%`;
  const fixed = Math.abs(value).toFixed(3);
  if (Number(fixed) === 0) return fixed;
  return `${value > 0 ? '+' : '\u2212'}${fixed}`;
}
