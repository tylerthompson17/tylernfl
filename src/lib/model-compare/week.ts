/**
 * The experimental page's list: the latest week's 4th downs that have a
 * stored pre-game experimental result (decisions.json), newest first, each
 * with both models' numbers, whether they disagree, a link to the call on
 * its game page and the form values that load it into the calculator.
 * Only per-play numbers and an outcome-free count of disagreements: no
 * outcomes, accuracy, records or WP-cost tallies (contract v5).
 */
import type { FourthDownDecision } from '../../data/types.ts';
import { valuesOf, type FormValues } from '../calculator/form.ts';
import type { FourthDownCall } from '../fourth-down.ts';
import { gameWords, situationWords } from '../decisions/view.ts';
import { teamsOf, type TeamValues } from './form.ts';
import type { Comparable } from './view.ts';

export interface WeekItem {
  key: string;
  gameId: string;
  playId: number;
  /** "CIN at BAL" */
  game: string;
  /** "4th and 3 at BAL 49, Q1 10:38, down 7" */
  situation: string;
  team: string;
  disagree: boolean;
  result: Comparable;
  /** The calculator's form for this situation, with its teams and punter */
  values: FormValues & TeamValues;
}

export interface WeekList {
  season: number;
  week: number;
  items: WeekItem[];
  disagree: number;
}

type Stored = FourthDownDecision & Required<Pick<FourthDownDecision, 'experimental' | 'wpGo' | 'kickDistance'>> & { call: FourthDownCall };

const stored = (d: FourthDownDecision): d is Stored =>
  d.experimental?.supported === true && typeof d.wpGo === 'number' && typeof d.kickDistance === 'number' && d.call !== null;

/**
 * The latest week with stored results, or null when none has any. Games
 * are ordered by `kickoff` (an ISO instant per gameId; missing sorts last),
 * newest first, and plays within a game latest first.
 */
export function weekList(fourthDowns: FourthDownDecision[], season: number, kickoff: (gameId: string) => string | null): WeekList | null {
  const all = fourthDowns.filter(stored);
  if (!all.length) return null;
  const week = Math.max(...all.map((d) => d.week));
  const items = all
    .filter((d) => d.week === week)
    .sort(
      (a, b) =>
        (kickoff(b.gameId) ?? '').localeCompare(kickoff(a.gameId) ?? '') ||
        b.gameId.localeCompare(a.gameId) ||
        b.playId - a.playId,
    )
    .map((d): WeekItem => ({
      key: `${d.gameId}-${d.playId}`,
      gameId: d.gameId,
      playId: d.playId,
      game: gameWords(d),
      situation: situationWords(d),
      team: d.situation.posteam,
      disagree: d.experimental.call !== d.call,
      result: {
        call: d.call,
        wpGo: d.wpGo,
        wpPunt: d.wpPunt ?? null,
        wpFieldGoal: d.wpFieldGoal ?? null,
        kickDistance: d.kickDistance,
        experimental: d.experimental,
      },
      values: { ...valuesOf(d.situation), ...teamsOf(d.situation) },
    }));
  return { season, week, items, disagree: items.filter((i) => i.disagree).length };
}

/** "The models disagree on 7 of 169." */
export function disagreeLine(list: WeekList): string {
  const n = list.items.length;
  return `The models disagree on ${list.disagree} of these ${n} ${n === 1 ? '4th down' : '4th downs'}.`;
}
