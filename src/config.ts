/**
 * Live scores in the ticker: during game windows, the browser polls ESPN's
 * public scoreboard and updates scores in place. Set to false to turn live
 * polling off entirely; the ticker then shows only ticker.json.
 */
export const LIVE_TICKER_ENABLED = true;

/**
 * Ranks built on fewer games than this carry a small-sample note. Early
 * in the season a single game can swing a team 20 places.
 */
export const SMALL_SAMPLE_GAMES = 4;

/**
 * Boards too long to list in full on their main page. Each shows the top N
 * for whatever column it is sorted by, with a link to the full list.
 */
export const LEADERBOARD_TOP_N: Record<string, number> = { defense: 100 };
