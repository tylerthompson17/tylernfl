/**
 * Retro Replays data for pages. The scenes, index.json and validation.json
 * are generated (pipelines/replays.py --all, in the deploy and locally), not
 * committed, so each is read only if present: a checkout without them still
 * builds, with empty states. featured.json is committed.
 */
import type { ReplayFeatured, ReplayIndexData, ReplayIndexEntry, ReplayScene, ReplayValidation } from '../data/types';
import featuredData from '../data/replays/featured.json';
import type { FeaturedReplay } from '../lib/replays/pick';
import { gameWords } from '../lib/replays/words';
import { url } from './url';

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

const sceneFiles = import.meta.glob<ReplayScene>('../data/replays/plays/*.json', { import: 'default' });

/** One scene by key, loaded only when asked for; null when it was not built. */
export async function sceneOf(key: string): Promise<ReplayScene | null> {
  const load = sceneFiles[`../data/replays/plays/${key}.json`];
  return load ? load() : null;
}

/**
 * The featured replays as the home page ships them (src/lib/replays/pick.ts):
 * a name, the description, the page and the scene's file
 * (src/pages/replays/scenes/[key].json.ts), so the page carries a short list
 * and loads one scene. Empty when replays are not in the build.
 */
export async function homeReplays(): Promise<FeaturedReplay[]> {
  const list: FeaturedReplay[] = [];
  for (const key of featuredKeys(builtKeys())) {
    const scene = await sceneOf(key);
    if (!scene) continue;
    list.push({
      key,
      title: gameWords(scene.play),
      description: scene.play.description,
      href: url(`replays/${key}`),
      scene: url(`replays/scenes/${key}.json`),
    });
  }
  return list;
}
