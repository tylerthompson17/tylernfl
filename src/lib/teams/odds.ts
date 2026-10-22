/**
 * Playoff chances as the pages write them. A simulation can never prove a
 * team in or out, so the ends read "<1%" and ">99%" rather than 0% or 100%,
 * whatever the count.
 */
export function formatChance(p: number): string {
  if (p < 0.005) return '<1%';
  if (p >= 0.995) return '>99%';
  return `${Math.round(p * 100)}%`;
}
