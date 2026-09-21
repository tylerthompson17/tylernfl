import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

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
  loader: glob({ pattern: '*.md', base: './src/content/charts' }),
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

export const collections = { articles, charts };
