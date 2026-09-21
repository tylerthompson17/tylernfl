import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';
import { postProblems } from './lib/curated/posts';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The glob loader for a folder of Markdown entries that may be empty. An
 * empty folder is skipped rather than globbed, since the glob loader warns
 * on every build when it finds nothing. See src/utils/collections.ts.
 */
function entries(base: string) {
  const loader = glob({ pattern: '*.md', base });
  return {
    name: 'entries',
    load: async (context: Parameters<typeof loader.load>[0]) => {
      const dir = join(process.cwd(), base);
      if (!existsSync(dir) || !readdirSync(dir).some((name) => name.endsWith('.md'))) {
        context.store.clear();
        return;
      }
      return loader.load(context);
    },
  };
}

const articles = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/articles' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    description: z.string(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
  }),
});

// Tyler's charts: the /charts gallery and the home page's featured chart.
// Each entry sits next to the SVG its script draws (<slug>.md, <slug>.svg);
// the scripts live in pipelines/charts/mine/, which is Tyler's. The home
// page's auto chart is not part of this collection.
const charts = defineCollection({
  loader: entries('./src/content/charts'),
  schema: z
    .object({
      title: z.string(),
      date: z.coerce.date(),
      author: z.string(),
      tags: z.array(z.string()).default([]),
      source: z.string(),
      /** One or two sentences on the takeaway. */
      note: z.string().max(300),
      featured: z.boolean().default(false),
      /** Filename of the script in pipelines/charts/mine/ that draws it. */
      script: z.string().regex(/^[\w-]+\.py$/),
      draft: z.boolean().default(false),
    })
    .strict(),
});

// Curated posts: X and Bluesky posts added by hand, shown as quote cards
// on /curated. There is no image field, and the schema is strict, so one
// cannot be added: a post's media is never stored or shown.
const curated = defineCollection({
  loader: entries('./src/content/curated'),
  schema: z
    .object({
      url: z.string().url(),
      platform: z.enum(['x', 'bluesky']),
      author: z.string().min(1),
      handle: z.string().min(1),
      /** When the post was made; the page sorts by this. */
      date: z.coerce.date(),
      /** The post's words, copied by hand. Line breaks are kept. */
      text: z.string(),
      /** Why it is here. Shown with as much weight as the post. */
      note: z.string().min(1),
      /** When it was copied, since the original can be edited or deleted. */
      added: z.coerce.date().optional(),
    })
    .strict()
    .superRefine((post, ctx) => {
      for (const message of postProblems(post)) ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    }),
});

export const collections = { articles, charts, curated };
