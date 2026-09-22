/**
 * What a team page needs at build time: its season from schedule.json and
 * its line in standings.json.
 */
import scheduleData from '../data/schedule.json';
import oddsData from '../data/playoff_odds.json';
import type { PlayoffOddsData, ScheduleData, TeamOdds, TeamStanding } from '../data/types';
import { formatKickoffDate } from '../lib/live-ticker/kickoff';
import { lineText, nextGame, ordinal, teamGames, type TeamGame } from '../lib/teams/hub';
import { standings, formatSigned } from './standings';
import { record } from '../lib/standings/ties';

export const schedule = scheduleData as ScheduleData;
export const playoffOdds = oddsData as PlayoffOddsData;

/** A team's playoff odds, or undefined before the season's first game. */
export function oddsOf(team: string): TeamOdds | undefined {
  return playoffOdds.teams.find((t) => t.team === team);
}

export function seasonOf(team: string): TeamGame[] {
  return teamGames(schedule.games, team);
}

export function standingOf(team: string): TeamStanding | undefined {
  return standings.teams.find((t) => t.team === team);
}

export interface HeaderFacts {
  record: string | null;
  place: string | null;
  diff: string | null;
  next: TeamGame | null;
  nextLine: string | null;
  /** The standings are last season's (before this season's first game) */
  lastSeason: boolean;
}

export function headerFacts(team: string): HeaderFacts {
  const standing = standingOf(team);
  const next = nextGame(seasonOf(team));
  const lastSeason = standing ? standings.season < schedule.season : false;
  return {
    record: standing ? record(standing) : null,
    place: standing ? `${ordinal(standing.divisionRank)} in ${standing.division}` : null,
    diff: standing ? formatSigned(standing.diff) : null,
    next,
    nextLine: next ? lineText(next.game) : null,
    lastSeason,
  };
}

/** Build-time text for a kickoff, in Eastern; the browser rewrites it. */
export function easternDate(iso: string | null, style: 'date' | 'datetime'): string {
  if (!iso) return 'Time to be announced';
  return formatKickoffDate(iso, style, 'en-US', 'America/New_York') ?? '';
}
