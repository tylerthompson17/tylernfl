/**
 * The experimental calculator's inputs (/fourth-down/experimental/): the
 * 4th down calculator's form (calculator/form.ts, unchanged) plus the teams
 * and the punter, which the experimental model reads (QB sneak usage and
 * punt coverage by offense, the punter by id). The extra fields ride in the
 * same query string after the calculator's own.
 */
import type { FourthDownSituation } from '../fourth-down.ts';

export interface TeamValues {
  offense: string;
  defense: string;
  /** ESPN athlete id, or '' for the offense's most recent punter */
  punter: string;
}

export type TeamField = keyof TeamValues;
export const TEAM_FIELDS: readonly TeamField[] = ['offense', 'defense', 'punter'];

export const DEFAULT_TEAMS: TeamValues = { offense: 'BUF', defense: 'KC', punter: '' };

/** Read the extra fields; a team or punter the menus do not offer takes the default. */
export function decodeTeams(search: string, teams: readonly string[], punters: ReadonlySet<string>): TeamValues {
  const params = new URLSearchParams(search);
  const team = (key: 'offense' | 'defense') => {
    const raw = params.get(key)?.toUpperCase() ?? '';
    return teams.includes(raw) ? raw : DEFAULT_TEAMS[key];
  };
  const offense = team('offense');
  let defense = team('defense');
  if (defense === offense) defense = teams.find((t) => t !== offense) ?? defense;
  const punter = params.get('punter') ?? '';
  return { offense, defense, punter: punters.has(punter) ? punter : '' };
}

/** The calculator's query string with the extra fields after it; the default punter is left out. */
export function encodeTeams(baseQuery: string, values: TeamValues): string {
  const params = new URLSearchParams(baseQuery);
  params.set('offense', values.offense);
  params.set('defense', values.defense);
  if (values.punter) params.set('punter', values.punter);
  return `?${params.toString().replaceAll('%3A', ':')}`;
}

/** An error for the defense field, or null. */
export function checkTeams(values: TeamValues): string | null {
  return values.offense === values.defense ? 'Pick a different team from the offense.' : null;
}

/**
 * The calculator's situation (built with its stand-in teams) with the
 * picked teams and punter. Which side is home carries over.
 */
export function withTeams(situation: FourthDownSituation, values: TeamValues): FourthDownSituation {
  const offenseHome = situation.home === situation.posteam;
  const out: FourthDownSituation = {
    ...situation,
    posteam: values.offense,
    defteam: values.defense,
    home: offenseHome ? values.offense : values.defense,
  };
  if (values.punter) out.punterId = values.punter;
  else delete out.punterId;
  return out;
}

/** The extra fields for a stored situation (a decisions.json record). */
export function teamsOf(situation: FourthDownSituation): TeamValues {
  return { offense: situation.posteam, defense: situation.defteam, punter: situation.punterId ?? '' };
}
