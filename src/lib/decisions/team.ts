/**
 * A team's 4th down and 2-point calls this season, game by game, for its
 * team page's 4th downs tab, from decisions.json (build time). For each
 * game: the team's questionable calls (WP lost 0.02 or more, as the
 * pipeline grades them) and its three biggest calls, the ones where
 * nfl4th's top two options were furthest apart, each listed once, in game
 * order. Games newest first.
 */
import type { DecisionsData } from '../../data/types.ts';
import type { Decision } from './view.ts';

export interface TeamCallRow {
  decision: Decision;
  questionable: boolean;
  /** Questionable with nfl4th's top two options closeMargin or more apart */
  clear: boolean;
  /** One of the game's three widest gaps between nfl4th's top two options */
  big: boolean;
}

export interface TeamGameCalls {
  gameId: string;
  week: number;
  /** A decision of the game, for its teams and chart */
  sample: Decision;
  rows: TeamCallRow[];
  /** Every graded decision the team made in the game */
  decisions: number;
}

export const BIG_CALLS = 3;

export function teamGameCalls(data: DecisionsData, team: string): TeamGameCalls[] {
  const close = data.summary.closeMargin;
  const mine = [...data.fourthDowns, ...data.tries].filter(
    (d) => d.situation.posteam === team && d.wpCost !== null && d.margin !== null && d.margin !== undefined,
  );
  const byGame = new Map<string, Decision[]>();
  for (const d of mine) byGame.set(d.gameId, [...(byGame.get(d.gameId) ?? []), d]);

  const games: TeamGameCalls[] = [];
  for (const [gameId, decisions] of byGame) {
    const big = new Set([...decisions].sort((a, b) => b.margin! - a.margin! || a.playId - b.playId).slice(0, BIG_CALLS));
    const rows = decisions
      .filter((d) => d.graded || big.has(d))
      .sort((a, b) => a.playId - b.playId)
      .map((d) => ({ decision: d, questionable: d.graded, clear: d.graded && d.margin! >= close, big: big.has(d) }));
    games.push({ gameId, week: decisions[0].week, sample: decisions[0], rows, decisions: decisions.length });
  }
  return games.sort((a, b) => b.week - a.week || b.gameId.localeCompare(a.gameId));
}
