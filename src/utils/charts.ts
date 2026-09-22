/**
 * Charts at build time: Tyler's charts from the content collection and
 * every auto chart the daily job has drawn (src/data/charts/archive/),
 * listed together in the gallery. The home page features one of Tyler's,
 * else today's auto chart (named by src/data/charts/auto.json). Every
 * problem with the collection fails the build, with a sentence saying
 * what to fix.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { CollectionEntry } from 'astro:content';
import { entriesOf } from './collections';
import teamsData from '../data/teams.json';
import type { ArchivedAutoChart, AutoChartData, TeamsData } from '../data/types';
import { chartProblems, labelSvg, resolveLogos, tagSlug } from '../lib/charts/collection';
import type { ChartHover } from '../lib/charts/hover';
import { url } from './url';

/** A chart in the gallery: one of Tyler's, or a kept auto chart. */
export interface Chart {
  id: string;
  data: Omit<CollectionEntry<'charts'>['data'], 'script'>;
  /** Drawn by the daily job rather than by Tyler. */
  auto: boolean;
}

/** The byline on an auto chart, where Tyler's name goes on his. */
export const AUTO_AUTHOR = 'Auto chart';

const svgs = import.meta.glob<string>('../content/charts/*.svg', { query: '?raw', import: 'default', eager: true });
const svgBySlug = new Map(
  Object.entries(svgs).map(([path, svg]) => [path.split('/').pop()!.replace(/\.svg$/, ''), svg])
);

const archiveSvgs = import.meta.glob<string>('../data/charts/archive/*.svg', { query: '?raw', import: 'default', eager: true });
const archiveEntries = import.meta.glob<ArchivedAutoChart>(
  ['../data/charts/archive/*.json', '!../data/charts/archive/*.hover.json'],
  { import: 'default', eager: true }
);
const archiveHovers = import.meta.glob<ChartHover>('../data/charts/archive/*.hover.json', { import: 'default', eager: true });

// Hover data beside each SVG (<slug>.hover.json), when its script made some.
const hovers = import.meta.glob<ChartHover>('../content/charts/*.hover.json', { import: 'default', eager: true });
const hoverBySlug = new Map(
  Object.entries(hovers).map(([path, data]) => [path.split('/').pop()!.replace(/\.hover\.json$/, ''), data])
);

const bySlug = <T>(files: Record<string, T>, ext: RegExp) =>
  new Map(Object.entries(files).map(([path, value]) => [path.split('/').pop()!.replace(ext, ''), value]));
const archiveSvgBySlug = bySlug(archiveSvgs, /\.svg$/);
const archiveHoverBySlug = bySlug(archiveHovers, /\.hover\.json$/);
const archiveBySlug = bySlug(archiveEntries, /\.json$/);

/** The kept auto charts, as gallery entries. */
function autoCharts(): Chart[] {
  return [...archiveBySlug].map(([id, entry]) => ({
    id,
    auto: true,
    data: {
      title: entry.title,
      date: new Date(`${entry.date}T00:00:00Z`),
      author: AUTO_AUTHOR,
      tags: entry.tags,
      teams: entry.teams ?? [],
      source: entry.source,
      note: entry.note,
      featured: false,
      draft: false,
    },
  }));
}
const autoJson = import.meta.glob<AutoChartData>('../data/charts/auto.json', { import: 'default', eager: true });

const teams = new Set((teamsData as TeamsData).map((team) => team.abbr));
const MINE = join(process.cwd(), 'pipelines', 'charts', 'mine');

function scriptsInMine(): Set<string> {
  return new Set(existsSync(MINE) ? readdirSync(MINE).filter((name) => name.endsWith('.py')) : []);
}

/**
 * Every chart to show, Tyler's and the kept auto charts, newest first.
 * Drafts appear in dev only. The checks run over every entry, drafts
 * included, since drafts render in dev.
 */
export async function getCharts(): Promise<Chart[]> {
  const all = await entriesOf('charts', 'src/content/charts');
  const problems = chartProblems(
    all.map((entry) => ({ slug: entry.id, featured: entry.data.featured, draft: entry.data.draft, script: entry.data.script })),
    new Set(svgBySlug.keys()),
    scriptsInMine(),
    new Set(archiveBySlug.keys())
  );
  if (problems.length > 0) throw new Error(`Charts collection:\n- ${problems.join('\n- ')}`);

  const mine: Chart[] = all.map(({ id, data: { script: _, ...data } }) => ({ id, data, auto: false }));
  const charts = [...mine, ...autoCharts()];
  const unknown = charts.flatMap((chart) => chart.data.teams.filter((team) => !teams.has(team)).map((team) => `${chart.id} names ${team}`));
  if (unknown.length > 0) throw new Error(`Charts name teams that do not exist:\n- ${unknown.join('\n- ')}`);

  return charts
    .filter((chart) => import.meta.env.DEV || !chart.data.draft)
    .sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf() || a.data.title.localeCompare(b.data.title));
}

/** The chart marked featured, if any is (and it is not a draft in production). */
export async function getFeaturedChart(): Promise<Chart | undefined> {
  return (await getCharts()).find((chart) => chart.data.featured && !chart.auto);
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
  return (chart.auto ? archiveSvgBySlug : svgBySlug).get(chart.id)!;
}

/** A chart's hover data, or null if its script wrote none. */
export function hoverFor(chart: Chart): ChartHover | null {
  return (chart.auto ? archiveHoverBySlug : hoverBySlug).get(chart.id) ?? null;
}

/** Today's auto chart, or null before the pipeline has drawn one. */
export function getAutoChart(): { id: string; data: ArchivedAutoChart; svg: string; hover: ChartHover | null } | null {
  const slug = Object.values(autoJson)[0]?.slug;
  const data = slug ? archiveBySlug.get(slug) : undefined;
  const svg = slug ? archiveSvgBySlug.get(slug) : undefined;
  return slug && data && svg ? { id: slug, data, svg, hover: archiveHoverBySlug.get(slug) ?? null } : null;
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

export interface ChartTeam {
  abbr: string;
  name: string;
  count: number;
}

/** Every team a chart is about, by abbreviation, with how many charts name it. */
export function chartTeams(charts: Chart[]): ChartTeam[] {
  const counts = new Map<string, number>();
  for (const chart of charts) {
    for (const abbr of new Set(chart.data.teams)) counts.set(abbr, (counts.get(abbr) ?? 0) + 1);
  }
  const names = new Map((teamsData as TeamsData).map((team) => [team.abbr, team.name]));
  return [...counts]
    .map(([abbr, count]) => ({ abbr, name: names.get(abbr) ?? abbr, count }))
    .sort((a, b) => a.abbr.localeCompare(b.abbr));
}

export const CHARTS_PER_PAGE = 12;
