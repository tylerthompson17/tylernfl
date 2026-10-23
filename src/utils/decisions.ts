/**
 * decisions.json, if the daily run has written one. Loaded by glob so a
 * checkout without it still builds: the pages then show their empty state.
 */
import type { DecisionsData } from '../data/types';

const files = import.meta.glob<DecisionsData>('../data/decisions.json', { eager: true, import: 'default' });

export const decisionsData: DecisionsData | null = Object.values(files)[0] ?? null;
