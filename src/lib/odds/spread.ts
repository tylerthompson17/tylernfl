/**
 * The point spread as the ticker shows it on an upcoming game: beside the
 * favored team, the way a sportsbook writes it ("-3", "-6.5"), and "PK"
 * beside the home team for a pick'em. From schedule.json's `spreadLine`
 * (nflverse: points the home team is favored by, negative when the road
 * team is); null when nflverse has no line yet.
 */

export interface TickerSpread {
  side: 'away' | 'home';
  /** What the slot shows: "-3", "-6.5", "PK". */
  text: string;
  /** What a screen reader hears: "favored by 3", "pick'em". */
  words: string;
}

export function tickerSpread(spreadLine: number | null | undefined): TickerSpread | null {
  if (spreadLine == null || !Number.isFinite(spreadLine)) return null;
  if (spreadLine === 0) return { side: 'home', text: 'PK', words: "pick'em" };
  const points = String(Math.abs(spreadLine));
  return { side: spreadLine > 0 ? 'home' : 'away', text: `-${points}`, words: `favored by ${points}` };
}
