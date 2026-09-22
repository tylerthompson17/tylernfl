/**
 * The stats overview's panels: the top 5 in eight categories, read at build
 * time from the full leaderboards (stats/{board}.json, daily) and from
 * player_epa.json (weekly). The home page's receiving panel and team pages
 * use the same lists, so a leader reads the same everywhere.
 */
import playerEpaData from '../data/player_epa.json';
import type { BoardRow, LeaderboardData, PlayerEpaCategory, PlayerEpaData, PlayerEpaRow } from '../data/types';
import { formatCell } from '../lib/leaderboard/arrange';
import { topOf, type Top } from '../lib/stats/top';
import { formatStat } from './format';
import { leaderboards } from './leaderboards';
import { slugForPlayer } from './players';

export const playerEpa = playerEpaData as PlayerEpaData;

export interface LeaderRow {
  rank: number;
  playerId: string;
  player: string;
  slug: string;
  team: string;
  value: string;
  extra: string | null;
}

export interface Leaders {
  key: string;
  label: string;
  valueLabel: string;
  extraLabel: string | null;
  rows: LeaderRow[];
  moreTied: number;
  tiedValue: string | null;
  /** What the numbers are through, e.g. "Through week 2." */
  through: string;
  /** Who counts, for rate stats. */
  qualifier: string | null;
  /** The full list this is the top of. */
  link: { href: string; text: string } | null;
}

interface BoardSpec {
  key: string;
  label: string;
  board: string;
  column: string;
  extra?: string;
}

// Counting stats from the boards: every player with more than zero.
const BOARD_PANELS: BoardSpec[] = [
  { key: 'passing', label: 'Passing yards', board: 'passing', column: 'passing_yards', extra: 'passing_tds' },
  { key: 'rushing', label: 'Rushing yards', board: 'rushing', column: 'rushing_yards', extra: 'rushing_tds' },
  { key: 'receiving', label: 'Receiving yards', board: 'receiving', column: 'receiving_yards', extra: 'receiving_tds' },
  { key: 'sacks', label: 'Sacks', board: 'defense', column: 'def_sacks' },
  { key: 'interceptions', label: 'Interceptions', board: 'defense', column: 'def_interceptions' },
  { key: 'kicking', label: 'Field goals made', board: 'kicking', column: 'fg_made', extra: 'fg_pct' },
];

function board(key: string): LeaderboardData | undefined {
  return leaderboards.find((b) => b.key === key);
}

function fromBoard(spec: BoardSpec): Leaders | null {
  const data = board(spec.board);
  if (!data) return null;
  const column = data.columns.find((c) => c.key === spec.column)!;
  const extra = spec.extra ? data.columns.find((c) => c.key === spec.extra) ?? null : null;
  const top: Top<BoardRow> = topOf(data.rows, {
    value: (row) => row.values[spec.column] ?? null,
    name: (row) => row.player,
    positiveOnly: true,
  });
  return {
    key: spec.key,
    label: spec.label,
    valueLabel: column.label,
    extraLabel: extra?.label ?? null,
    rows: top.rows.map(({ rank, item }) => ({
      rank,
      playerId: item.playerId,
      player: item.player,
      slug: slugForPlayer(item.playerId, item.player),
      team: item.team,
      value: formatCell(item.values[spec.column] ?? null, column, 'totals'),
      extra: extra ? formatCell(item.values[extra.key] ?? null, extra, 'totals') : null,
    })),
    moreTied: top.moreTied,
    tiedValue: top.tiedValue === null ? null : formatCell(top.tiedValue, column, 'totals'),
    through: data.throughWeek ? `Through week ${data.throughWeek}.` : 'No games played yet.',
    qualifier: null,
    link: { href: `stats/${spec.board}`, text: `Full ${data.label.toLowerCase()} leaderboard` },
  };
}

function fromEpa(category: PlayerEpaCategory): Leaders {
  const top: Top<PlayerEpaRow> = topOf(category.rows, { value: (row) => row.value, name: (row) => row.player });
  return {
    key: category.key,
    label: category.label,
    valueLabel: category.valueLabel,
    extraLabel: category.playsLabel,
    rows: top.rows.map(({ rank, item }) => ({
      rank,
      playerId: item.playerId,
      player: item.player,
      slug: slugForPlayer(item.playerId, item.player),
      team: item.team,
      value: formatStat(item.value, 'signed3'),
      extra: String(item.plays),
    })),
    moreTied: top.moreTied,
    tiedValue: top.tiedValue === null ? null : formatStat(top.tiedValue, 'signed3'),
    through: playerEpa.throughWeek
      ? `Through week ${playerEpa.throughWeek}; updated Wednesdays.`
      : 'No games played yet.',
    qualifier: `${category.qualifier.text} EPA is nflfastR's.`,
    link: null,
  };
}

/** The eight panels, in the order the overview shows them. */
export function overviewPanels(): Leaders[] {
  const boards = BOARD_PANELS.map(fromBoard).filter((p): p is Leaders => p !== null);
  const epa = playerEpa.categories.map(fromEpa);
  return [...boards, ...epa];
}

/** One panel by key, for the home page and team pages. */
export function leadersFor(key: string): Leaders | undefined {
  return overviewPanels().find((panel) => panel.key === key);
}

/** The season the boards cover. */
export function boardSeason(): number | null {
  return leaderboards[0]?.season ?? null;
}
