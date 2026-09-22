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

/** The label the odds carry wherever they are shown. */
export function oddsLabel(pricedGames: number, remainingGames: number): string {
  if (remainingGames === 0) return 'The regular season is over.';
  if (pricedGames === 0) return 'Based on betting lines; no remaining game has a line yet, so all are even odds.';
  return "Based on betting lines for next week's games; later games are even odds.";
}
