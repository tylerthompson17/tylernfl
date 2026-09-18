/**
 * Team rosters read at build time from src/data/rosters/. The pipeline
 * writes one file per team; this is the only place that knows that.
 */
import type { PositionGroup, RosterPlayer, TeamRoster } from '../data/types';

const files = import.meta.glob<TeamRoster>('../data/rosters/*.json', {
  eager: true,
  import: 'default',
});

/** Every team roster, by abbreviation. */
export const rosters: TeamRoster[] = Object.values(files).sort((a, b) =>
  a.team.localeCompare(b.team)
);

const byTeam = new Map(rosters.map((roster) => [roster.team, roster]));

export function rosterFor(abbr: string): TeamRoster | undefined {
  return byTeam.get(abbr);
}

/** A player together with the roster they appear on. */
export interface RosterEntry {
  player: RosterPlayer;
  team: string;
  season: number;
}

export const rosterPlayers: RosterEntry[] = rosters.flatMap((roster) =>
  roster.players.map((player) => ({ player, team: roster.team, season: roster.season }))
);

/** nflverse status code for the practice squad, shown apart from the roster. */
export const PRACTICE_SQUAD = 'DEV';

export interface PlayerGroup {
  key: PositionGroup;
  label: string;
  players: RosterPlayer[];
}

/**
 * Split players into the roster's position groups, in the order the
 * pipeline set, dropping groups nobody is in.
 */
export function groupPlayers(roster: TeamRoster, players: RosterPlayer[]): PlayerGroup[] {
  return roster.groups
    .map((group) => ({
      key: group.key,
      label: group.label,
      players: players.filter((player) => player.group === group.key),
    }))
    .filter((group) => group.players.length > 0);
}
