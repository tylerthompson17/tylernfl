/**
 * The header search index as a script module (dist/search-index.js). It is
 * static build output like any page, loaded by the search box the first
 * time it is used, not data fetched at runtime.
 */
import type { APIRoute } from 'astro';
import { buildSearchIndex } from '../utils/search-index';

export const GET: APIRoute = async () => {
  const entries = await buildSearchIndex();
  return new Response(`export default ${JSON.stringify(entries)};\n`, {
    headers: { 'Content-Type': 'text/javascript; charset=utf-8' },
  });
};
