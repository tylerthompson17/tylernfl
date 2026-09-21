/**
 * Rules for curated posts: hand-added X and Bluesky posts shown as quote
 * cards. Kept apart from Astro so the schema (src/content.config.ts) and
 * Node's test runner share them. A post that breaks a rule fails the
 * build with a sentence saying what to fix.
 *
 * Nothing here fetches anything. The card is built from the fields Tyler
 * typed in; the only links out are to the author's profile and to the
 * original post. Posts' images are never stored or shown.
 */

export type Platform = 'x' | 'bluesky';

export const PLATFORM_NAMES: Record<Platform, string> = { x: 'X', bluesky: 'Bluesky' };

/** "an X", "a Bluesky": X is said "ex". */
function aPlatform(platform: Platform): string {
  return `${platform === 'x' ? 'an' : 'a'} ${PLATFORM_NAMES[platform]}`;
}

export interface PostUrl {
  platform: Platform;
  /** Handle as it appears in the URL, or a Bluesky DID. */
  account: string;
  id: string;
}

/**
 * The platform, account and post id from a post's URL, or null when it is
 * not a link to a single post. X links may use twitter.com; query strings
 * (?s=20) are ignored.
 */
export function parsePostUrl(url: string): PostUrl | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  const host = parsed.hostname.replace(/^(www|mobile)\./, '');
  const parts = parsed.pathname.split('/').filter(Boolean);

  if ((host === 'x.com' || host === 'twitter.com') && parts.length === 3 && parts[1] === 'status') {
    if (!/^\d+$/.test(parts[2]!)) return null;
    return { platform: 'x', account: parts[0]!, id: parts[2]! };
  }
  if (host === 'bsky.app' && parts.length === 4 && parts[0] === 'profile' && parts[2] === 'post') {
    return { platform: 'bluesky', account: parts[1]!, id: parts[3]! };
  }
  return null;
}

/** "@JoshAllenQB" or "JoshAllenQB" -> "JoshAllenQB". */
export function bareHandle(handle: string): string {
  return handle.trim().replace(/^@/, '');
}

export function profileUrl(platform: Platform, handle: string): string {
  const bare = bareHandle(handle);
  return platform === 'x' ? `https://x.com/${bare}` : `https://bsky.app/profile/${bare}`;
}

const HANDLE_PATTERNS: Record<Platform, RegExp> = {
  // X: letters, digits and underscores, up to 15.
  x: /^[A-Za-z0-9_]{1,15}$/,
  // Bluesky: a domain, e.g. name.bsky.social or a custom domain.
  bluesky: /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]*$/i,
};

/**
 * Links in post text that point at the platforms' own image and video
 * hosts. A post's media is never stored or shown here, so pasting one in
 * is an error: link to the post instead.
 */
const MEDIA_LINK = /\b(pbs\.twimg\.com|video\.twimg\.com|pic\.(twitter|x)\.com|cdn\.bsky\.app|video\.bsky\.app)\b/i;

export interface PostCheck {
  url: string;
  platform: Platform;
  handle: string;
  text: string;
}

export function postProblems(post: PostCheck): string[] {
  const problems: string[] = [];
  const handle = bareHandle(post.handle);
  const name = PLATFORM_NAMES[post.platform];

  if (!HANDLE_PATTERNS[post.platform].test(handle)) {
    problems.push(`"${post.handle}" is not ${aPlatform(post.platform)} handle.`);
  }

  const url = parsePostUrl(post.url);
  if (!url) {
    problems.push(`${post.url} is not a link to a single X or Bluesky post.`);
  } else if (url.platform !== post.platform) {
    problems.push(`The url is ${aPlatform(url.platform)} post, but platform says ${name}.`);
  } else if (!url.account.startsWith('did:') && url.account.toLowerCase() !== handle.toLowerCase()) {
    // A Bluesky link can name the account by DID instead of handle; then
    // there is nothing to compare.
    problems.push(`The url is from @${url.account}, but handle says @${handle}.`);
  }

  const media = post.text.match(MEDIA_LINK);
  if (media) {
    problems.push(`The text links to ${media[0]}, a post image or video. Leave media out; the card links to the post.`);
  }
  if (post.text.trim() === '') problems.push('The text is empty.');
  return problems;
}
