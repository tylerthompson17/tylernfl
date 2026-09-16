/**
 * Prefix an internal path with the configured base path so links work
 * both locally and under /tylernfl on GitHub Pages.
 *
 * url()        -> "/tylernfl/"
 * url('stats') -> "/tylernfl/stats/"
 */
export function url(path = ''): string {
  const base = import.meta.env.BASE_URL.replace(/\/+$/, '');
  const clean = path.replace(/^\/+/, '');
  if (clean === '') return `${base}/`;
  // Keep trailing slashes consistent with Astro's directory build format,
  // but leave file-style paths (anything with an extension) untouched.
  const suffix = /\.[a-z0-9]+$/i.test(clean) || clean.endsWith('/') ? '' : '/';
  return `${base}/${clean}${suffix}`;
}
