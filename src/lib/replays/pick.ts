/**
 * Which featured replay the home page shows: one at random on each visit,
 * never the one shown last (remembered in localStorage by src/lib/replays/home.ts).
 */

/** One featured replay as the home page ships it: enough to name it and find its scene. */
export interface FeaturedReplay {
  key: string;
  /** "CHI at ARI, 2018 week 3" (`gameWords`) */
  title: string;
  description: string;
  /** The replay's page */
  href: string;
  /** Its scene, a static file of the build */
  scene: string;
}

/**
 * A random index into `keys`, never the one whose key is `avoid` unless it
 * is the only one; null for an empty list. `random` is in [0, 1).
 */
export function pickReplay(keys: readonly string[], avoid: string | null, random: () => number = Math.random): number | null {
  const choices = keys.map((_, i) => i).filter((i) => keys.length === 1 || keys[i] !== avoid);
  if (choices.length === 0) return null;
  return choices[Math.min(Math.floor(random() * choices.length), choices.length - 1)]!;
}
