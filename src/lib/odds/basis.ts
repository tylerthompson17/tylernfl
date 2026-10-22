/**
 * What the playoff odds and the draft projection are based on, in the words
 * every page uses. This is the one place the wording lives: the team pages'
 * odds panel and header strip and both draft tabs read it, so when team
 * ratings replace the 50/50 default (GAME_PROBABILITIES in
 * pipelines/playoff_odds.py) it changes here, once.
 *
 * Today a game is priced from its betting line when it has one, and every
 * other game counts as 50/50 for each team: no team strength, no home field.
 */

/** The parts of a schedule game the wording needs (ScheduleGame fits). */
export interface BasisGame {
  week: number;
  type: string;
  homeScore: number | null;
  awayScore: number | null;
  homeMoneyline: number | null;
  awayMoneyline: number | null;
}

export interface OddsBasis {
  /** One sentence or two, for a panel's footnote */
  long: string;
  /** A few words, for a figure in a header strip */
  short: string;
  /** Weeks of unplayed regular season games with a line */
  pricedWeeks: number[];
  /** Weeks of unplayed regular season games without one, counted as 50/50 */
  evenWeeks: number[];
}

/** "week 9", "weeks 7 and 8", "weeks 9 to 18", "weeks 7, 8 and 10 to 18". */
export function formatWeeks(weeks: number[]): string {
  const sorted = [...new Set(weeks)].sort((a, b) => a - b);
  const parts: string[] = [];
  let start = 0;
  for (let i = 1; i <= sorted.length; i++) {
    if (i < sorted.length && sorted[i] === sorted[i - 1] + 1) continue;
    const run = sorted.slice(start, i);
    if (run.length >= 3) parts.push(`${run[0]} to ${run[run.length - 1]}`);
    else parts.push(...run.map(String));
    start = i;
  }
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
  return `${sorted.length === 1 ? 'week' : 'weeks'} ${list}`;
}

/** Which unplayed regular season weeks have lines and which count as 50/50. */
export function splitWeeks(games: BasisGame[]): { pricedWeeks: number[]; evenWeeks: number[] } {
  const priced = new Set<number>();
  const even = new Set<number>();
  for (const g of games) {
    if (g.type !== 'REG' || (g.homeScore !== null && g.awayScore !== null)) continue;
    (g.homeMoneyline !== null && g.awayMoneyline !== null ? priced : even).add(g.week);
  }
  const sorted = (s: Set<number>) => [...s].sort((a, b) => a - b);
  return { pricedWeeks: sorted(priced), evenWeeks: sorted(even) };
}

export function oddsBasis(games: BasisGame[]): OddsBasis {
  const { pricedWeeks, evenWeeks } = splitWeeks(games);
  const weeks = { pricedWeeks, evenWeeks };
  if (pricedWeeks.length === 0 && evenWeeks.length === 0) {
    return { long: 'The regular season is over.', short: 'regular season over', ...weeks };
  }
  if (pricedWeeks.length === 0) {
    return {
      long: 'No remaining game has a betting line yet, so every game counts as 50/50 for each team.',
      short: 'every game 50/50',
      ...weeks,
    };
  }
  if (evenWeeks.length === 0) {
    return { long: 'Based on betting lines for every remaining game.', short: 'based on betting lines', ...weeks };
  }
  return {
    long:
      `Based on betting lines for ${formatWeeks(pricedWeeks)}. ` +
      `Games without a line yet (${formatWeeks(evenWeeks)}) count as 50/50 for each team.`,
    short: `${formatWeeks(evenWeeks)} at 50/50`,
    ...weeks,
  };
}

/** The draft projection also plays out the playoffs. */
export function playoffBasis(pricedPlayoffGames: number): string {
  return pricedPlayoffGames === 0
    ? 'Every playoff game counts as 50/50 for each team.'
    : 'Playoff games use their betting line where they have one; the rest count as 50/50 for each team.';
}
