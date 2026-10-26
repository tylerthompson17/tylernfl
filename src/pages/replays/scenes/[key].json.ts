/**
 * The featured replays' scenes as static files, for the home page's replay
 * panel, which loads the one it picked (src/lib/replays/home.ts). Featured
 * only: every other replay is embedded in its own page.
 */
import type { APIRoute, GetStaticPaths } from 'astro';
import { builtKeys, featuredKeys, sceneOf } from '../../../utils/replays';

export const getStaticPaths = (() => featuredKeys(builtKeys()).map((key) => ({ params: { key } }))) satisfies GetStaticPaths;

export const GET: APIRoute = async ({ params }) => {
  const scene = await sceneOf(params.key!);
  return new Response(JSON.stringify(scene), { headers: { 'Content-Type': 'application/json' } });
};
