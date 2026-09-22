/**
 * Rules for the charts collection, kept apart from Astro so they run under
 * Node's test runner. src/utils/charts.ts applies them to the real entries
 * at build time and fails the build on any problem.
 */

export interface ChartCheck {
  slug: string;
  featured: boolean;
  draft: boolean;
  /** Script filename in pipelines/charts/mine/ */
  script: string;
}

/**
 * Slugs that would collide with other routes under /charts: page numbers
 * belong to the gallery's pagination, "tag" to the tag pages and "team" to
 * the team pages.
 */
export function reservedSlug(slug: string): boolean {
  return /^\d+$/.test(slug) || slug === 'tag' || slug === 'team';
}

/**
 * Every problem with the collection, as sentences for the build error.
 * Drafts count for missing files (they render in dev) but not for the
 * featured rule, which is about what the built site shows.
 */
export function chartProblems(
  entries: ChartCheck[],
  svgSlugs: Set<string>,
  scripts: Set<string>,
  autoSlugs: Set<string> = new Set()
): string[] {
  const problems: string[] = [];
  for (const entry of entries) {
    if (autoSlugs.has(entry.slug)) {
      problems.push(`"${entry.slug}" cannot be a chart name: a kept auto chart already has it. Rename ${entry.slug}.md and its SVG.`);
    }
    if (reservedSlug(entry.slug)) {
      problems.push(`"${entry.slug}" cannot be a chart name: it is taken by the gallery's own pages.`);
    }
    if (!svgSlugs.has(entry.slug)) {
      problems.push(`${entry.slug}.md has no ${entry.slug}.svg next to it. Run its script to draw it.`);
    }
    if (!scripts.has(entry.script)) {
      problems.push(`${entry.slug}.md names script ${entry.script}, which is not in pipelines/charts/mine/.`);
    }
  }
  const featured = entries.filter((entry) => entry.featured && !entry.draft).map((entry) => entry.slug);
  if (featured.length > 1) {
    problems.push(`Only one chart can be featured; these all are: ${featured.join(', ')}.`);
  }
  return problems;
}

/** URL part for a tag: "4th down" -> "4th-down", "EPA" -> "epa". */
export function tagSlug(tag: string): string {
  return tag
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Point each logo reference a chart carries ("logo:BUF", written by
 * pipelines/charts/style.py) at the site's copy of that logo. Charts never
 * embed logos, so the base path is the site's to add, not the pipeline's.
 * A team with no logo is an error, not a blank space.
 */
export function resolveLogos(svg: string, logoUrl: (team: string) => string, teams: Set<string>): string {
  return svg.replace(/href="logo:([A-Z]{2,3})"/g, (_, team: string) => {
    if (!teams.has(team)) throw new Error(`Chart refers to a logo for ${team}, which is not a team.`);
    return `href="${logoUrl(team)}"`;
  });
}

/**
 * The accessible name and description go on the chart itself: a chart is
 * one image to a screen reader, named by its title and described by its
 * note, rather than a few hundred loose labels.
 */
export function labelSvg(svg: string, labelId: string, descId: string): string {
  return svg.replace(
    /<svg\b/,
    `<svg role="img" aria-labelledby="${labelId}" aria-describedby="${descId}" focusable="false"`
  );
}
