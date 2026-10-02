/**
 * Target maps read at build time from src/data/targets/, one file per
 * player with at least one target or throw (pipelines/targets.py).
 */
import type { TargetsData } from '../data/types';

const files = import.meta.glob<TargetsData>('../data/targets/*.json', { eager: true, import: 'default' });

const byPlayer = new Map(Object.values(files).map((data) => [data.playerId, data]));

export function targetsFor(playerId: string | null): TargetsData | undefined {
  return playerId ? byPlayer.get(playerId) : undefined;
}
