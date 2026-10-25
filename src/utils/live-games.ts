/**
 * The ticker week's games by ESPN id, for the live 4th down page and the
 * home panel: teams, kickoff, and the lines and roof the model needs from
 * schedule.json. ESPN supplies only the game state, in the browser.
 */
import scheduleData from '../data/schedule.json';
import tickerData from '../data/ticker.json';
import type { ScheduleData, TickerData } from '../data/types';
import type { FeedGame } from '../lib/live-fourth/feed';

export function liveGames(): Record<string, FeedGame> {
  const ticker = tickerData as TickerData;
  const byId = new Map((scheduleData as ScheduleData).games.map((g) => [g.id, g]));
  const games: Record<string, FeedGame> = {};
  for (const g of ticker.games) {
    const s = byId.get(g.id);
    if (!g.espnId || !s) continue;
    games[g.espnId] = {
      season: ticker.season,
      away: g.away,
      home: g.home,
      kickoff: g.kickoff,
      spreadLine: s.spreadLine,
      totalLine: s.totalLine,
      roof: s.roof,
    };
  }
  return games;
}
