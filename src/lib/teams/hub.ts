/**
 * A team's season from schedule.json, as the team pages show it. Pure
 * functions, so they run under Node's test runner.
 */
import type { ScheduleGame } from '../../data/types.ts';

export interface TeamGame {
  game: ScheduleGame;
  home: boolean;
  opponent: string;
  /** Null until played */
  result: 'W' | 'L' | 'T' | null;
  teamScore: number | null;
  opponentScore: number | null;
  /** Regular season record after this game, e.g. "3-1"; null until played or in the playoffs */
  recordAfter: string | null;
}

export function played(game: ScheduleGame): boolean {
  return game.awayScore !== null && game.homeScore !== null;
}

/** The team's games in schedule order, seen from its side. */
export function teamGames(games: ScheduleGame[], team: string): TeamGame[] {
  const out: TeamGame[] = [];
  let w = 0;
  let l = 0;
  let t = 0;
  for (const game of games) {
    if (game.away !== team && game.home !== team) continue;
    const home = game.home === team;
    const teamScore = home ? game.homeScore : game.awayScore;
    const opponentScore = home ? game.awayScore : game.homeScore;
    let result: TeamGame['result'] = null;
    let recordAfter: string | null = null;
    if (played(game)) {
      result = teamScore! > opponentScore! ? 'W' : teamScore! < opponentScore! ? 'L' : 'T';
      if (game.type === 'REG') {
        if (result === 'W') w++;
        else if (result === 'L') l++;
        else t++;
        recordAfter = t ? `${w}-${l}-${t}` : `${w}-${l}`;
      }
    }
    out.push({ game, home, opponent: home ? game.away : game.home, result, teamScore, opponentScore, recordAfter });
  }
  return out;
}

/** The first game not yet played, in schedule order. */
export function nextGame(games: TeamGame[]): TeamGame | null {
  return games.find((g) => g.result === null) ?? null;
}

/** "W 41-31", "L 20-24 (OT)", "T 20-20": the team's score first. */
export function resultText(g: TeamGame): string | null {
  if (!g.result) return null;
  return `${g.result} ${g.teamScore}-${g.opponentScore}${g.game.overtime ? ' (OT)' : ''}`;
}

/** "at MIA", "vs NYJ": neutral site games read "vs" for both teams. */
export function opponentText(g: TeamGame): string {
  return `${g.home || g.game.neutral ? 'vs' : 'at'} ${g.opponent}`;
}

/**
 * The line as a fan reads it: the favorite and by how much, "SEA by 7",
 * "BUF by 3.5", or "Pick'em". spreadLine is points the home team is
 * favored by. Null without a line.
 */
export function lineText(game: ScheduleGame): string | null {
  if (game.spreadLine === null) return null;
  if (game.spreadLine === 0) return "Pick'em";
  const favorite = game.spreadLine > 0 ? game.home : game.away;
  return `${favorite} by ${Math.abs(game.spreadLine)}`;
}

/** 1 -> "1st", 2 -> "2nd", 3 -> "3rd", 4 -> "4th". */
export function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${suffix}`;
}
