/**
 * Charts at build time: Tyler's charts from the content collection (the
 * gallery and the featured chart) and the daily auto chart from src/data.
 * Every problem with the collection fails the build, with a sentence
 * saying what to fix.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { CollectionEntry } from 'astro:content';
import { entriesOf } from './collections';
import teamsData from '../data/teams.json';
import type { AutoChartData, TeamsData } from '../data/types';
import { chartProblems, labelSvg, resolveLogos, tagSlug } from '../lib/charts/collection';
import type { ChartHover } from '../lib/charts/hover';
import { url } from './url';

export type Chart = CollectionEntry<'charts'>;

const svgs = import.meta.glob<string>('../content/charts/*.svg', { query: '?raw', import: 'default', eager: true });
const svgBySlug = new Map(
  Object.entries(svgs).map(([path, svg]) => [path.split('/').pop()!.replace(/\.svg$/, ''), svg])
);

const autoSvgs = import.meta.glob<string>('../data/charts/auto.svg', { query: '?raw', import: 'default', eager: true });

// Hover data beside each SVG (<slug>.hover.json), when its script made some.
const hovers = import.meta.glob<ChartHover>('../content/charts/*.hover.json', { import: 'default', eager: true });
const hoverBySlug = new Map(
  Object.entries(hovers).map(([path, data]) => [path.split('/').pop()!.replace(/\.hover\.json$/, ''), data])
);
const autoHovers = import.meta.glob<ChartHover>('../data/charts/auto.hover.json', { import: 'default', eager: true });
const autoJson = import.meta.glob<AutoChartData>('../data/charts/auto.json', { import: 'default', eager: true });

const teams = new Set((teamsData as TeamsData).map((team) => team.abbr));
const MINE = join(process.cwd(), 'pipelines', 'charts', 'mine');

function scriptsInMine(): Set<string> {
  return new Set(existsSync(MINE) ? readdirSync(MINE).filter((name) => name.endsWith('.py')) : []);
}

/**
 * Tyler's charts to show, newest first. Drafts appear in dev only. The
 * checks run over every entry, drafts included, since drafts render in dev.
 */
export async function getCharts(): Promise<Chart[]> {
  const all = await entriesOf('charts', 'src/content/charts');
  const problems = chartProblems(
    all.map((entry) => ({ slug: entry.id, featured: entry.data.featured, draft: entry.data.draft, script: entry.data.script })),
    new Set(svgBySlug.keys()),
    scriptsInMine()
  );
  if (problems.length > 0) throw new Error(`Charts collection:\n- ${problems.join('\n- ')}`);

  return all
    .filter((entry) => import.meta.env.DEV || !entry.data.draft)
    .sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf() || a.data.title.localeCompare(b.data.title));
}

/** The chart marked featured, if any is (and it is not a draft in production). */
export async function getFeaturedChart(): Promise<Chart | undefined> {
  return (await getCharts()).find((chart) => chart.data.featured);
}

/**
 * A chart's SVG ready to place inline: logos pointed at the site's copies
 * under the base path, and the image named and described by the title and
 * note already on the page (by those elements' ids).
 */
export function chartSvg(svg: string, labelId: string, descId: string): string {
  return labelSvg(
    resolveLogos(svg, (team) => url(`logos/${team}.png`), teams),
    labelId,
    descId
  );
}

export function svgFor(chart: Chart): string {
  return svgBySlug.get(chart.id)!;
}

/** A chart's hover data, or null if its script wrote none. */
export function hoverFor(chart: Chart): ChartHover | null {
  return hoverBySlug.get(chart.id) ?? null;
}

/** The daily auto chart, or null before the pipeline has drawn one. */
export function getAutoChart(): { data: AutoChartData; svg: string; hover: ChartHover | null } | null {
  const data = Object.values(autoJson)[0];
  const svg = Object.values(autoSvgs)[0];
  return data && svg ? { data, svg, hover: Object.values(autoHovers)[0] ?? null } : null;
}

export function formatChartDate(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

export interface ChartTag {
  slug: string;
  /** As first written; tags differing only in case or punctuation merge. */
  label: string;
  count: number;
}

/** Every tag in use, alphabetical, with how many charts carry it. */
export function chartTags(charts: Chart[]): ChartTag[] {
  const tags = new Map<string, ChartTag>();
  for (const chart of charts) {
    for (const label of new Set(chart.data.tags.map((tag) => tagSlug(tag)))) {
      const original = chart.data.tags.find((tag) => tagSlug(tag) === label)!;
      const tag = tags.get(label) ?? { slug: label, label: original, count: 0 };
      tag.count += 1;
      tags.set(label, tag);
    }
  }
  return [...tags.values()].sort((a, b) => a.label.localeCompare(b.label));
}

export const CHARTS_PER_PAGE = 12;
