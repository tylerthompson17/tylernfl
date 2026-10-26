import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickReplay } from '../src/lib/replays/pick.ts';

const keys = ['a', 'b', 'c'];

test('never picks the play shown last', () => {
  for (let i = 0; i < 100; i++) assert.notEqual(keys[pickReplay(keys, 'b', () => i / 100)!], 'b');
});

test('every other play can come up', () => {
  const seen = new Set([0, 0.49, 0.5, 0.999].map((r) => keys[pickReplay(keys, 'b', () => r)!]));
  assert.deepEqual([...seen].sort(), ['a', 'c']);
});

test('any play when none was shown, or the last one is gone', () => {
  assert.equal(keys[pickReplay(keys, null, () => 0.99)!], 'c');
  assert.equal(keys[pickReplay(keys, 'zz', () => 0)!], 'a');
});

test('a single play repeats; an empty list gives nothing', () => {
  assert.equal(pickReplay(['a'], 'a'), 0);
  assert.equal(pickReplay([], null), null);
});
