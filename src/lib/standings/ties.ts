/**
 * Tiebreaks in words, for the notes under the standings tables. The order
 * itself comes from pipelines/standings.py; this only says what decided
 * it, for teams with the same record.
 */
import type { TeamStanding, TiebreakStep } from '../../data/types.ts';

export const STEP_WORDS: Record<TiebreakStep, string> = {
  head_to_head: 'head-to-head',
  head_to_head_sweep: 'head-to-head sweep',
  division_record: 'division record',
  common_games: 'record in common games',
  conference_record: 'conference record',
  strength_of_victory: 'strength of victory',
  strength_of_schedule: 'strength of schedule',
  division_order: 'the division standings',
  coin_toss: 'coin toss',
};

/** "10-7", or "9-7-1" with a tie. */
export function record(team: Pick<TeamStanding, 'wins' | 'losses' | 'ties'>): string {
  return team.ties ? `${team.wins}-${team.losses}-${team.ties}` : `${team.wins}-${team.losses}`;
}

function list(names: string[]): string {
  if (names.length <= 2) return names.join(' and ');
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/**
 * One sentence per group of teams on the same record whose order a
 * tiebreaker set, in the order given (division or conference order).
 * `step` picks which tiebreak field to read.
 */
export function tieNotes(teams: TeamStanding[], step: 'divisionTiebreak' | 'conferenceTiebreak'): string[] {
  const groups = new Map<string, TeamStanding[]>();
  for (const team of teams) {
    const key = record(team);
    groups.set(key, [...(groups.get(key) ?? []), team]);
  }
  const notes: string[] = [];
  for (const [rec, group] of groups) {
    if (group.length < 2) continue;
    const steps = [...new Set(group.map((t) => t[step]).filter((s): s is TiebreakStep => s !== null))];
    if (steps.length === 0) continue;
    const names = group.map((t) => t.team);
    const how = steps.map((s) => STEP_WORDS[s]).join(', then ');
    const both = group.length === 2 ? 'are both' : 'are all';
    notes.push(
      group.length === 2 && steps.length === 1
        ? `${names[0]} and ${names[1]} ${both} ${rec}; ${names[0]} is ahead on ${how}.`
        : `${list(names)} ${both} ${rec}; order set by ${how}.`
    );
  }
  return notes;
}
