/**
 * Game pages at build time: one per file in src/data/games/ (written by
 * pipelines/games.py for every final with play-by-play). Links to a game
 * page go through gameHref, which is null for a game that has none yet
 * (a final whose play-by-play nflverse has not published), so no link
 * ever 404s.
 */
import type { GameData } from '../data/types';
import { gamePath } from '../lib/games/view';
import { url } from './url';

const files = import.meta.glob<GameData>('../data/games/*.json', { eager: true, import: 'default' });

/** Every game with a page, oldest first. */
export const gamePages: GameData[] = Object.values(files).sort(
  (a, b) => a.season - b.season || a.week - b.week || (a.kickoff ?? '').localeCompare(b.kickoff ?? '') || a.id.localeCompare(b.id)
);

const byId = new Map(gamePages.map((g) => [g.id, g]));

/** The game page for an nflverse game id, or null when it has none. */
export function gameHref(gameId: string): string | null {
  const game = byId.get(gameId);
  return game ? url(gamePath(game)) : null;
}
