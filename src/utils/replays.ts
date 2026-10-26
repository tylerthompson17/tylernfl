/** Retro Replays helpers for pages. */

/** Keys of the plays that have a replay: the scenes in src/data/replays/plays/. */
export function builtKeys(): Set<string> {
  const files = import.meta.glob('../data/replays/plays/*.json');
  return new Set(Object.keys(files).map((path) => path.split('/').pop()!.replace(/\.json$/, '')));
}
