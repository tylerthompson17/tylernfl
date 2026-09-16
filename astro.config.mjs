// @ts-check
import { defineConfig } from 'astro/config';

// GitHub Pages project site: served from /tylernfl under the user pages domain.
export default defineConfig({
  site: 'https://tylerthompson17.github.io',
  base: '/tylernfl',
  output: 'static',
});
