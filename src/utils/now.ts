/**
 * The current moment for anything date-dependent, at build time or in the
 * browser. Normally the real clock; a build with SITE_NOW set (see
 * astro.config.mjs) is frozen at that instant, so the audit can load the
 * site as it reads on a Sunday during games or in the offseason. Read the
 * clock through this, never with `new Date()` or `Date.now()`.
 */
declare const __SITE_NOW__: string | undefined;

const fixed = typeof __SITE_NOW__ === 'string' && __SITE_NOW__ ? __SITE_NOW__ : null;

export function siteNow(): Date {
  return fixed ? new Date(fixed) : new Date();
}
