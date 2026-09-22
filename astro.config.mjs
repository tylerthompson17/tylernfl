// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';

// GitHub Pages project site: served from /tylernfl under the user pages domain.
export default defineConfig({
  site: 'https://tylerthompson17.github.io',
  base: '/tylernfl',
  output: 'static',
  integrations: [mdx()],
  // Every page carries its own CSS (about 3 KB gzipped). GitHub Pages lets
  // browsers and its CDN keep a page for 10 minutes, and each deploy
  // replaces the whole site: a page cached before a deploy would otherwise
  // ask for the previous build's stylesheet, get a 404, and load unstyled.
  build: { inlineStylesheets: 'always' },
});
