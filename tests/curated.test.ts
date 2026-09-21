import assert from 'node:assert/strict';
import { test } from 'node:test';

import { bareHandle, parsePostUrl, postProblems, profileUrl, type PostCheck } from '../src/lib/curated/posts.ts';

const post = (overrides: Partial<PostCheck> = {}): PostCheck => ({
  url: 'https://bsky.app/profile/sample-analyst.example/post/3lxyzabc123',
  platform: 'bluesky',
  handle: 'sample-analyst.example',
  text: 'Fourth and 2 at midfield and they punted.',
  ...overrides,
});

test('post links from both platforms are read, including twitter.com and query strings', () => {
  assert.deepEqual(parsePostUrl('https://x.com/example_handle/status/1969999999999999999?s=20'), {
    platform: 'x',
    account: 'example_handle',
    id: '1969999999999999999',
  });
  assert.equal(parsePostUrl('https://twitter.com/example_handle/status/42')?.platform, 'x');
  assert.equal(parsePostUrl('https://mobile.twitter.com/example_handle/status/42')?.platform, 'x');
  assert.deepEqual(parsePostUrl('https://bsky.app/profile/did:plc:abc123/post/3lxyz'), {
    platform: 'bluesky',
    account: 'did:plc:abc123',
    id: '3lxyz',
  });
});

test('anything but a single post is not a post link', () => {
  for (const url of [
    'https://x.com/example_handle',
    'https://x.com/example_handle/status/not-a-number',
    'http://x.com/example_handle/status/42',
    'https://bsky.app/profile/sample-analyst.example',
    'https://example.com/status/42',
    'not a url',
  ]) {
    assert.equal(parsePostUrl(url), null, url);
  }
});

test('handles are shown and linked without the at sign twice', () => {
  assert.equal(bareHandle(' @example_handle '), 'example_handle');
  assert.equal(profileUrl('x', '@example_handle'), 'https://x.com/example_handle');
  assert.equal(profileUrl('bluesky', 'sample-analyst.example'), 'https://bsky.app/profile/sample-analyst.example');
});

test('a well-formed post has no problems', () => {
  assert.deepEqual(postProblems(post()), []);
  assert.deepEqual(
    postProblems(post({ url: 'https://x.com/Example_Handle/status/42', platform: 'x', handle: '@example_handle' })),
    []
  );
});

test('a Bluesky link by DID cannot be checked against the handle, so it passes', () => {
  assert.deepEqual(postProblems(post({ url: 'https://bsky.app/profile/did:plc:abc123/post/3lxyz' })), []);
});

test('each mistake is named, with what to fix', () => {
  assert.deepEqual(postProblems(post({ platform: 'x', handle: 'not a handle!' })), [
    '"not a handle!" is not an X handle.',
    'The url is a Bluesky post, but platform says X.',
  ]);
  assert.deepEqual(
    postProblems(post({ url: 'https://x.com/example_handle/status/42', handle: 'example_handle' })),
    ['"example_handle" is not a Bluesky handle.', 'The url is an X post, but platform says Bluesky.']
  );
});

test('the url and handle must name the same account', () => {
  assert.deepEqual(postProblems(post({ handle: 'someone-else.example' })), [
    'The url is from @sample-analyst.example, but handle says @someone-else.example.',
  ]);
});

test('a link to a post image or video fails: media is never stored or shown', () => {
  for (const host of ['pbs.twimg.com/media/abc.jpg', 'pic.x.com/abc', 'pic.twitter.com/abc', 'cdn.bsky.app/img/abc', 'video.bsky.app/abc']) {
    const problems = postProblems(post({ text: `Look at this https://${host}` }));
    assert.equal(problems.length, 1, host);
    assert.match(problems[0]!, /a post image or video/);
  }
  assert.deepEqual(postProblems(post({ text: 'Read the thread at https://example.com/story' })), []);
});

test('empty text fails', () => {
  assert.deepEqual(postProblems(post({ text: '   ' })), ['The text is empty.']);
});
