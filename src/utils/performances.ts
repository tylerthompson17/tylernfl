/**
 * The week's notable performances, joined at build time from the game logs
 * in players/{TEAM}.json. The rule that picks them lives in
 * src/lib/performances/notable.ts; this only feeds it and adds the page
 * slug each row links to.
 */
import type { PlayerLogsData } from '../data/types';
import { notablePerformances, type Performance, type WeekLine } from '../lib/performances/notable';
import { slugForPlayer } from './players';

const files = import.meta.glob<PlayerLogsData>('../data/players/*.json', { eager: true, import: 'default' });

export interface NotableRow extends Performance {
  slug: string;
}

export interface NotableWeek {
  season: number;
  /** The last completed week, from the logs themselves. Null before week 1. */
  week: number | null;
  /** Teams with a game logged this week, so the page can say how much is in. */
  teams: number;
  rows: NotableRow[];
}

/**
 * Logs cover the season, so the week to show is the latest one any game
 * has been logged for. That is not the ticker's week: from Wednesday the
 * ticker looks ahead to games not played yet.
 */
function collect(): NotableWeek {
  const all = Object.values(files);
  const season = all[0]?.season ?? 0;

  let week = 0;
  for (const file of all) {
    for (const player of Object.values(file.players)) {
      for (const rows of Object.values(player.boards)) {
        for (const row of rows) if (row[0] > week) week = row[0];
      }
    }
  }
  if (week === 0) return { season, week: null, teams: 0, rows: [] };

  const lines: WeekLine[] = [];
  const teams = new Set<string>();
  const seen = new Set<string>();
  for (const file of all) {
    for (const [playerId, player] of Object.entries(file.players)) {
      for (const [board, rows] of Object.entries(player.boards)) {
        const keys = file.columns[board] ?? [];
        for (const [rowWeek, team, opponent, home, , ...rest] of rows) {
          if (rowWeek !== week) continue;
          teams.add(team);
          // A player on two rosters this season appears in both files with
          // the same logs; keep the first copy of each game.
          const key = `${playerId}:${board}`;
          if (seen.has(key)) continue;
          seen.add(key);
          lines.push({
            playerId,
            player: player.name,
            team,
            opponent,
            home: home === 1,
            board,
            values: Object.fromEntries(keys.map((key, i) => [key, rest[i] ?? null])),
          });
        }
      }
    }
  }

  const rows = notablePerformances(lines).map((row) => ({
    ...row,
    slug: slugForPlayer(row.playerId, row.player),
  }));
  return { season, week, teams: teams.size, rows };
}

export const notable: NotableWeek = collect();
