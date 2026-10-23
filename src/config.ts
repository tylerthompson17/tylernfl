/**
 * Live scores in the ticker: during game windows, the browser polls ESPN's
 * public scoreboard and updates scores in place. Set to false to turn live
 * polling off entirely; the ticker then shows only ticker.json.
 */
export const LIVE_TICKER_ENABLED = true;

/**
 * The home page's live 4th down panel, which reads the ticker's poll. Set to
 * false to turn off just the panel: the home page keeps the calculator's
 * examples, and the ticker is unchanged. With LIVE_TICKER_ENABLED false
 * there is no poll, so the panel never shows either way.
 */
export const LIVE_FOURTH_DOWN_ENABLED = true;

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
