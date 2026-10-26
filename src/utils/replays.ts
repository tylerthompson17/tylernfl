/**
 * Retro Replays data for pages. The scenes, index.json and validation.json
 * are generated (pipelines/replays.py --all, in the deploy and locally), not
 * committed, so each is read only if present: a checkout without them still
 * builds, with empty states. featured.json is committed.
 */
import type { ReplayFeatured, ReplayIndexData, ReplayIndexEntry, ReplayValidation } from '../data/types';
import featuredData from '../data/replays/featured.json';

const generated = import.meta.glob<unknown>(['../data/replays/index.json', '../data/replays/validation.json'], {
  eager: true,
  import: 'default',
});

/** Keys of the plays that have a replay: the scenes in src/data/replays/plays/. */
export function builtKeys(): Set<string> {
  const files = import.meta.glob('../data/replays/plays/*.json');
  return new Set(Object.keys(files).map((path) => path.split('/').pop()!.replace(/\.json$/, '')));
}

/** Every play in the highlights collection, facts only; empty before generation. */
export function replayIndex(): ReplayIndexEntry[] {
  return (generated['../data/replays/index.json'] as ReplayIndexData | undefined)?.plays ?? [];
}

export function replayValidation(): ReplayValidation | null {
  return (generated['../data/replays/validation.json'] as ReplayValidation | undefined) ?? null;
}

/** The featured keys that have a replay, in Tyler's order (one that failed its checks is left out). */
export function featuredKeys(built: Set<string>): string[] {
  return (featuredData as ReplayFeatured).keys.filter((key) => built.has(key));
}
