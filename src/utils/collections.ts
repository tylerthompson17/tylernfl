/**
 * Collections that can legitimately be empty: curated posts before the
 * first is added, charts if the example is deleted before a real chart
 * exists. Astro warns on every build about an empty collection, twice
 * (the glob loader finding no files, then getCollection finding no
 * collection), and it cannot hold an empty one. So an empty folder is
 * checked here first and never handed to either.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { getCollection, type CollectionEntry, type CollectionKey } from 'astro:content';

/** Whether a content folder (relative to the project root) has any entries. */
export function hasEntries(base: string): boolean {
  const dir = join(process.cwd(), base);
  return existsSync(dir) && readdirSync(dir).some((name) => name.endsWith('.md'));
}

/** Every entry in a collection, or none, without the empty-collection warning. */
export async function entriesOf<C extends CollectionKey>(collection: C, base: string): Promise<CollectionEntry<C>[]> {
  return hasEntries(base) ? getCollection(collection) : [];
}
