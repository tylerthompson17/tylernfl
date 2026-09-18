/**
 * Team stats read at build time from team_stats.json, shaped for the league
 * tables on /stats/teams and the panel on each team page.
 */
import teamStatsData from '../data/team_stats.json';
import type { TeamStatLine, TeamStatMetric, TeamStatsData } from '../data/types';
import { SMALL_SAMPLE_GAMES } from '../config';
import { formatStat } from './format';

export const teamStats = teamStatsData as TeamStatsData;

export type Side = TeamStatMetric['side'];

export function metricsFor(side: Side): TeamStatMetric[] {
  return teamStats.metrics.filter((metric) => metric.side === side);
}

export function teamLine(abbr: string): TeamStatLine | undefined {
  return teamStats.teams.find((team) => team.abbr === abbr);
}

export function isSmallSample(games: number): boolean {
  return games < SMALL_SAMPLE_GAMES;
}

/** Rank column header, marked when the ranks rest on a small sample. */
export function rankLabel(smallSample: boolean): string {
  return smallSample ? 'Rk*' : 'Rk';
}

export const SMALL_SAMPLE_NOTE = `* Fewer than ${SMALL_SAMPLE_GAMES} games played. Ranks this early can swing a long way on one game.`;

/** "62 plays", "1 trip". */
export function sampleText(n: number, noun: string): string {
  return `${n} ${n === 1 ? noun.replace(/s$/, '') : noun}`;
}

/**
 * One row per team for a side's league table, best first by that side's
 * lead metric (EPA per play). Teams without a rank go last.
 */
export function leagueRows(side: Side) {
  const metrics = metricsFor(side);
  const lead = metrics[0]!.key;
  return [...teamStats.teams]
    .sort(
      (a, b) =>
        (a.values[lead]!.rank ?? Infinity) - (b.values[lead]!.rank ?? Infinity) ||
        a.abbr.localeCompare(b.abbr)
    )
    .map((team) => {
      const row: Record<string, string | number | null> = { team: team.abbr, games: team.games };
      for (const metric of metrics) {
        const stat = team.values[metric.key]!;
        row[metric.key] = formatStat(stat.value, metric.format);
        row[`${metric.key}_rank`] = stat.rank;
      }
      return row;
    });
}

/** The league table's columns: team, games, then a value and rank per metric. */
export function leagueColumns(side: Side, smallSample: boolean) {
  return [
    { key: 'team', label: 'Team', kind: 'team' as const },
    { key: 'games', label: 'G', kind: 'number' as const },
    ...metricsFor(side).flatMap((metric) => [
      { key: metric.key, label: 'Value', kind: 'number' as const, group: metric.short },
      {
        key: `${metric.key}_rank`,
        label: rankLabel(smallSample),
        kind: 'number' as const,
        group: metric.short,
      },
    ]),
  ];
}

/**
 * A team's offense and defense side by side, one row per measure. Metrics
 * pair by key: off_epa with def_epa.
 */
export function teamPanelRows(team: TeamStatLine) {
  return metricsFor('offense').map((off) => {
    const def = teamStats.metrics.find((m) => m.key === off.key.replace(/^off_/, 'def_'))!;
    const o = team.values[off.key]!;
    const d = team.values[def.key]!;
    return {
      measure: off.label,
      offValue: formatStat(o.value, off.format),
      offRank: o.rank,
      offSample: sampleText(o.n, off.sample),
      defValue: formatStat(d.value, def.format),
      defRank: d.rank,
      defSample: sampleText(d.n, def.sample),
    };
  });
}
