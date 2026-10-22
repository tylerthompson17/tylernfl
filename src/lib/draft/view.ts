/**
 * The draft pages' words and states, from draft_order.json
 * (pipelines/draft_order.py). The order itself is decided in the pipeline;
 * this only says what the pages show about it, including when the file is
 * missing or behind.
 */
import type { DraftOrderData, DraftPick, ProjectedPick } from '../../data/types.ts';
import { STEP_WORDS } from '../standings/ties.ts';

/** A daily file this much older than the build is called out as behind. */
export const STALE_HOURS = 36;

export type DraftState =
  /** No draft_order.json at all */
  | { kind: 'missing' }
  /** A file, but the season has no games yet */
  | { kind: 'not_started'; data: DraftOrderData; stale: boolean }
  | { kind: 'ready'; data: DraftOrderData; stale: boolean };

/**
 * Whether a file written at `updated` is past STALE_HOURS at `now`. The
 * build checks it, and so does the page in the browser against the
 * visitor's clock: a failed daily run means no new build, so only the
 * browser can notice the data ageing after that.
 */
export function isOld(updated: string, now: Date): boolean {
  const age = (now.getTime() - Date.parse(updated)) / 3_600_000;
  return !(age <= STALE_HOURS);
}

export function draftState(data: DraftOrderData | null | undefined, now: Date, siteSeason: number): DraftState {
  if (!data) return { kind: 'missing' };
  // A file for an earlier season than the site is on is behind however new.
  const stale = data.season < siteSeason || isOld(data.updated, now);
  return { kind: data.stage === 'not_started' ? 'not_started' : 'ready', data, stale };
}

export const STALE_NOTE = 'This is not the latest daily update, so the order may be behind.';

/** "October 22, 2026", the Eastern date the file was written. */
export function dataDate(updated: string): string {
  if (Number.isNaN(Date.parse(updated))) return 'an unknown date';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(updated));
}

/** "Data from October 22, 2026." plus a warning when the file is behind. */
export function dataLine(state: DraftState): string {
  if (state.kind === 'missing') return '';
  const date = `Data from ${dataDate(state.data.updated)}.`;
  return state.stale ? `${date} ${STALE_NOTE}` : date;
}

/** "10-7", or "9-7-1" with a tie. */
export function draftRecord(p: Pick<DraftPick, 'wins' | 'losses' | 'ties'>): string {
  return p.ties ? `${p.wins}-${p.losses}-${p.ties}` : `${p.wins}-${p.losses}`;
}

/** What decided a pick's place among teams on its record, in words. */
export function tiebreakWords(p: Pick<DraftPick, 'tiebreak' | 'coinFlip'>): string {
  if (p.coinFlip) return 'Coin flip, still to come';
  if (!p.tiebreak) return '';
  const words = STEP_WORDS[p.tiebreak as keyof typeof STEP_WORDS] ?? p.tiebreak.replaceAll('_', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Who holds a pick when it is not the team's own: "NYJ" with "from IND",
 * or for a pick a choice decides, the choice in words.
 */
export function ownerNote(p: Pick<DraftPick, 'team' | 'owner' | 'choice'>, settled = false): string | null {
  if (p.choice) {
    const { between, takes, to } = p.choice;
    if (p.owner === to) return `${to} hold it: ${to} get the ${takes} of ${between[0]}'s and ${between[1]}'s picks`;
    const other = between.find((t) => t !== p.team) ?? between[1];
    if (settled) return `${p.owner} hold it: ${to} got the ${takes} of the two, ${other}'s`;
    return `${p.owner} hold it for now; ${to} get it instead if it lands ${takes === 'earlier' ? 'before' : 'after'} ${other}'s pick`;
  }
  return p.owner !== p.team ? `${p.owner} hold it` : null;
}

/** The same for a projected pick, whose owner a choice may leave open. */
export function projectedOwnerNote(t: Pick<ProjectedPick, 'team' | 'owner'>): string | null {
  if (t.owner === null) return 'Owner depends on where it lands';
  return t.owner !== t.team ? `${t.owner} hold it` : null;
}

/** The groups as the current order's table names them. */
const GROUP_WORDS: Record<DraftPick['group'], string> = {
  non_playoff: 'Missed the playoffs',
  wild_card: 'Out in the wild card round',
  divisional: 'Out in the divisional round',
  conference: 'Out in the conference round',
  super_bowl: 'Lost the Super Bowl',
  alive: 'Still playing',
  champion: 'Won the Super Bowl',
};

/** A team's status: during the regular season, only where it stands today. */
export function groupWords(group: DraftPick['group'], stage: DraftOrderData['stage']): string {
  if (stage === 'regular_season') return group === 'non_playoff' ? 'Outside the playoff places' : 'In a playoff place';
  return GROUP_WORDS[group];
}

/** The intro line for the current order, by stage. */
export function stageNote(stage: DraftOrderData['stage']): string {
  switch (stage) {
    case 'regular_season':
      return 'Picks 1 to 18 are the teams outside today\'s playoff places, worst record first. Picks 19 to 32 are today\'s 14 playoff teams, also by record, but the real order of 19 to 32 depends on playoff results: teams that go out earlier pick earlier.';
    case 'playoffs':
      return 'Teams already out of the playoffs are placed by the round they lost in. Teams still playing pick after them, by record for now; the real order depends on how far each goes.';
    case 'final':
      return 'The order is final: the regular season and playoffs are complete.';
    default:
      return '';
  }
}

/** "Jets get Dallas's pick 74% of the time, Green Bay's 26%." */
export function choiceLine(
  c: { between: [string, string]; takes: string; to: string; chances: Record<string, number> },
  name: (abbr: string) => string,
  percent: (p: number) => string,
): string {
  const [a, b] = c.between;
  return (
    `${name(c.to)} get the ${c.takes} of ${name(a)}'s and ${name(b)}'s picks: ` +
    `${name(a)}'s ${percent(c.chances[a] ?? 0)} of the time, ${name(b)}'s ${percent(c.chances[b] ?? 0)}.`
  );
}
