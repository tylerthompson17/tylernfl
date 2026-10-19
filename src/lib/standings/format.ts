/**
 * The ways standings numbers are written. Kept apart from utils/standings.ts,
 * which imports standings.json, so the browser can use them (live records in
 * src/lib/live-ticker/records.ts) without bundling the file.
 */

/** ".667", "1.000", ".000": the way standings print it. */
export function formatPct(pct: number): string {
  return pct >= 1 ? '1.000' : pct.toFixed(3).replace(/^0/, '');
}

/** "+34", "−12" with a true minus, "0". */
export function formatSigned(value: number): string {
  if (value > 0) return `+${value}`;
  if (value < 0) return `−${Math.abs(value)}`;
  return '0';
}

/** [4, 1, 0] -> "4-1"; [4, 1, 1] -> "4-1-1". */
export function formatRecord([w, l, t]: [number, number, number]): string {
  return t ? `${w}-${l}-${t}` : `${w}-${l}`;
}
