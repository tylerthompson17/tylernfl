import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

// The scenes and validation.json are generated (python pipelines/replays.py
// --all), locally and in CI, not committed. Where they exist, every featured
// play must have passed its checks; the deploy drops a failing one from
// Featured with a warning, so this test is what catches it first.
const validationPath = new URL('../src/data/replays/validation.json', import.meta.url);
const featuredPath = new URL('../src/data/replays/featured.json', import.meta.url);
const generated = existsSync(validationPath);

test(
  'every featured replay passes its checks',
  { skip: generated ? false : 'no generated replay data: run python pipelines/replays.py --all' },
  () => {
    const validation = JSON.parse(readFileSync(validationPath, 'utf8')) as { featuredDropped: Record<string, string[]> };
    assert.deepEqual(validation.featuredDropped, {});
  },
);

test('featured keys are unique play keys', () => {
  const { keys } = JSON.parse(readFileSync(featuredPath, 'utf8')) as { keys: string[] };
  assert.equal(new Set(keys).size, keys.length);
  for (const key of keys) assert.match(key, /^\d{4}_[A-Z]{2,3}_\d{10}_\d+$/);
});
