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
