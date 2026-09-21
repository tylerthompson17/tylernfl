/**
 * The header search index, built with the site: every player page, every
 * team, and the site's pages. src/pages/search-index.js.ts writes it out as
 * a script module that the search box loads the first time it is used.
 */
import teamsData from '../data/teams.json';
import type { TeamsData } from '../data/types';
import type { SearchEntry } from '../lib/search/match';
import { getArticles } from './articles';
import { getCharts } from './charts';
import { leaderboards } from './leaderboards';
import { playerPages } from './players';
import { url } from './url';

const teams = teamsData as TeamsData;
const teamName = new Map(teams.map((team) => [team.abbr, team.name]));

/** Players with a stat line this season rank above those without. */
const withStats = new Set(leaderboards.flatMap((board) => board.rows.map((row) => row.playerId)));

const STATUS_WEIGHT: Record<string, number> = { ACT: 3, RES: 1, DEV: 1 };

function nickname(abbr: string): string {
  return teamName.get(abbr)?.split(' ').at(-1) ?? '';
}

function playerEntries(): SearchEntry[] {
  const entries: SearchEntry[] = [];
  for (const pages of playerPages.values()) {
    // A shared name's bare slug lists everyone who has it; each of them
    // also has a page of their own, which is what search links to.
    if (pages.length !== 1) continue;
    const page = pages[0]!;
    const roster = page.roster;
    entries.push({
      kind: 'player',
      label: page.name,
      detail: roster ? `${roster.position}, ${page.team}` : page.team,
      href: url(`players/${page.slug}`),
      terms: `${page.team} ${nickname(page.team)}`,
      weight:
        (roster ? (STATUS_WEIGHT[roster.status] ?? 0) : 0) +
        (roster?.gsisId && withStats.has(roster.gsisId) ? 6 : 0),
    });
  }
  return entries;
}

function teamEntries(): SearchEntry[] {
  return teams.map((team) => ({
    kind: 'team' as const,
    label: team.name,
    detail: 'Team',
    href: url(`teams/${team.abbr}`),
    terms: team.abbr,
    weight: 0,
  }));
}

async function pageEntries(): Promise<SearchEntry[]> {
  const page = (label: string, path: string, terms: string, detail = 'Page'): SearchEntry => ({
    kind: 'page',
    label,
    detail,
    href: url(path),
    terms,
    weight: 0,
  });
  const articles = await getArticles();
  const charts = await getCharts();
  return [
    page('Scores', 'scores', 'scoreboard schedule games slate results week kickoff'),
    page('Stat leaders', 'stats', 'stats leaders top', 'Stats'),
    ...leaderboards.map((board) =>
      page(`${board.label} leaderboard`, `stats/${board.key}`, 'stats leaders', 'Stats')
    ),
    page('Team stats', 'stats/teams', 'epa success rate third down red zone offense defense', 'Stats'),
    page('Charts', 'charts', 'chart graph gallery visual'),
    ...charts.map((chart) =>
      page(chart.data.title, `charts/${chart.id}`, `chart ${chart.data.tags.join(' ')}`, 'Chart')
    ),
    page('Transactions and injuries', 'transactions', 'injury report roster moves wire signings releases'),
    page('4th down calculator', 'tools/4th-down', 'fourth down go for it punt field goal', 'Tools'),
    page('Tools', 'tools', 'calculators'),
    page('Articles', 'articles', 'writing'),
    ...articles.map((article) =>
      page(article.data.title, `articles/${article.id}`, article.data.tags.join(' '), 'Article')
    ),
    page('About', 'about', 'site contact'),
  ];
}

export async function buildSearchIndex(): Promise<SearchEntry[]> {
  return [...teamEntries(), ...(await pageEntries()), ...playerEntries()];
}
