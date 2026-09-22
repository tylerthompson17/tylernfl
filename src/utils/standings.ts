/**
 * standings.json at build time, and the few ways its numbers are written.
 */
import standingsData from '../data/standings.json';
import type { StandingsData, TeamStanding } from '../data/types';

export const standings = standingsData as StandingsData;

export const DIVISION_ORDER = ['East', 'North', 'South', 'West'];

/** Divisions of one conference in the usual East, North, South, West order. */
export function divisionsOf(conference: 'AFC' | 'NFC'): { name: string; teams: TeamStanding[] }[] {
  return DIVISION_ORDER.map((part) => {
    const name = `${conference} ${part}`;
    return {
      name,
      teams: standings.teams.filter((t) => t.division === name).sort((a, b) => a.divisionRank - b.divisionRank),
    };
  });
}

/** Seeds 1 to 16 of one conference. */
export function seedsOf(conference: 'AFC' | 'NFC'): TeamStanding[] {
  return standings.teams.filter((t) => t.conference === conference).sort((a, b) => a.conferenceRank - b.conferenceRank);
}

/** ".667", "1.000", ".000": the way standings print it. */
export function formatPct(pct: number): string {
  return pct >= 1 ? '1.000' : pct.toFixed(3).replace(/^0/, '');
}

/** "+34", "−12" with a true minus, "0". */
export function formatSigned(value: number): string {
  if (value > 0) return `+${value}`;
  if (value < 0) return `−${Math.abs(value)}`;
  return '0';
}

/** [4, 1, 0] -> "4-1"; [4, 1, 1] -> "4-1-1". */
export function formatRecord([w, l, t]: [number, number, number]): string {
  return t ? `${w}-${l}-${t}` : `${w}-${l}`;
}
