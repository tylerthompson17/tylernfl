// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';

// SITE_NOW (an ISO instant) builds the site as of that moment instead of the
// real clock: every date-dependent reading goes through siteNow() in
// src/utils/now.ts. Only the audit's date states set it
// (scripts/audit-pages.ts --state); production builds leave it unset.
const siteNow = process.env.SITE_NOW ?? '';
if (siteNow && Number.isNaN(Date.parse(siteNow))) {
  throw new Error(`SITE_NOW is not a date: ${siteNow}`);
}

// GitHub Pages project site: served from /tylernfl under the user pages domain.
const base = '/tylernfl';

export default defineConfig({
  site: 'https://tylerthompson17.github.io',
  base,
  output: 'static',
  integrations: [mdx()],
  // The calculator moved out of tools/ when it went live. Astro does not add
  // the base path to a redirect's destination.
  redirects: { '/tools/4th-down': `${base}/fourth-down/` },
  // Every page carries its own CSS (about 3 KB gzipped). GitHub Pages lets
  // browsers and its CDN keep a page for 10 minutes, and each deploy
  // replaces the whole site: a page cached before a deploy would otherwise
  // ask for the previous build's stylesheet, get a 404, and load unstyled.
  build: { inlineStylesheets: 'always' },
  vite: {
    define: { __SITE_NOW__: JSON.stringify(siteNow) },
    // The 4th down model's files are fetched by the calculator as hashed
    // assets (src/lib/calculator/load.ts); never inline the small ones into
    // its script as data URLs.
    build: { assetsInlineLimit: (file) => (file.includes('/models/fourth-down/') ? false : undefined) },
  },
});
