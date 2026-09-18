/**
 * A player's season on each leaderboard plus his game log, joined at build
 * time from stats/{board}.json (season totals and ranks) and
 * players/{TEAM}.json (game logs), by nflverse player id.
 */
import type { BoardRow, LeaderboardData, PlayerLogsData } from '../data/types';
import { leaderboards } from './leaderboards';

const files = import.meta.glob<PlayerLogsData>('../data/players/*.json', { eager: true, import: 'default' });
const logsByPlayer = new Map<string, { file: PlayerLogsData; boards: Record<string, PlayerLogsData['players'][string]['boards'][string]> }>();
for (const file of Object.values(files)) {
  for (const [id, player] of Object.entries(file.players)) logsByPlayer.set(id, { file, boards: player.boards });
}

export interface GameLine {
  week: number;
  team: string;
  opponent: string;
  home: boolean;
  result: string | null;
  values: Record<string, number | null>;
}

export interface BoardSeason {
  board: LeaderboardData;
  season: BoardRow;
  /** Rank by the board's primary stat, and whether another player shares it */
  rank: number;
  tied: boolean;
  games: GameLine[];
}

/** The player's boards, the ones he has played the most games in first. */
export function seasonsFor(playerId: string | null): BoardSeason[] {
  if (!playerId) return [];
  const logs = logsByPlayer.get(playerId);
  const seasons: BoardSeason[] = [];
  for (const board of leaderboards) {
    const season = board.rows.find((row) => row.playerId === playerId);
    if (!season) continue;
    const keys = logs?.file.columns[board.key] ?? [];
    const games = (logs?.boards[board.key] ?? []).map(([week, team, opponent, home, result, ...rest]) => ({
      week,
      team,
      opponent,
      home: home === 1,
      result,
      values: Object.fromEntries(keys.map((key, i) => [key, rest[i] ?? null])),
    }));
    seasons.push({
      board,
      season,
      rank: season.rank,
      tied: board.rows.some((row) => row !== season && row.rank === season.rank),
      games,
    });
  }
  const order = leaderboards.map((board) => board.key);
  return seasons.sort(
    (a, b) => b.games.length - a.games.length || order.indexOf(a.board.key) - order.indexOf(b.board.key)
  );
}

/** 1 -> "1st", 22 -> "22nd", 13 -> "13th". */
export function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${suffix}`;
}
