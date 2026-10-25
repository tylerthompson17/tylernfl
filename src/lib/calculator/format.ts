/**
 * The 4th down calculator's output, as words and numbers ready to show:
 * the call, each option's win probability and the outcomes behind it, the
 * margin between the top two, the options the model left out and why, and
 * what it had to assume. Pure; dom.ts only puts these into the page.
 */
import type { FourthDownCall, FourthDownResult, TryCall, TryResult } from '../fourth-down.ts';
import { KICK_LABEL_OFFSET } from '../field/strip.ts';

export interface Part {
  label: string;
  value: string;
  /** Why the value is what it is (a tooltip and screen reader text) */
  note?: string;
}

export interface OptionView {
  key: string;
  label: string;
  wp: string;
  best: boolean;
  parts: Part[];
}

export type CalculatorView =
  | { kind: 'unsupported'; message: string }
  | {
      kind: 'result';
      /** "Go for it", "Kick the extra point" */
      call: string;
      /** "By 3.4 percentage points of win probability over a field goal." */
      margin: string;
      options: OptionView[];
      skipped: { label: string; reason: string }[];
      notes: string[];
    };

/** What the model fell back to for a missing total (the manifest's fallbackTotalLine). */
export interface Fallbacks {
  total: { value: number; season: number };
  /**
   * nfl4th's kick distance offset (yards to the goal line plus this, 18):
   * labels convert its kickDistance to the conventional plus 17.
   */
  kickOffset?: number;
}

const OPTION_LABEL: Record<FourthDownCall | TryCall, string> = {
  go: 'Go for it',
  'field goal': 'Field goal',
  punt: 'Punt',
  kick: 'Kick the extra point',
  'go for 2': 'Go for 2',
};

/** In the margin sentence: "over a field goal". */
const OPTION_NOUN: Record<FourthDownCall | TryCall, string> = {
  go: 'going for it',
  'field goal': 'a field goal',
  punt: 'a punt',
  kick: 'the extra point',
  'go for 2': 'going for 2',
};

/** The contract's tie order for the 4th down: go, then field goal, then punt. */
const TIE_ORDER: FourthDownCall[] = ['go', 'field goal', 'punt'];

/** A probability as a percent to one place: 0.5220 -> "52.2%". */
export function pct(p: number): string {
  return `${(p * 100).toFixed(1)}%`;
}

const UNSUPPORTED: Record<'overtime' | 'endgame' | 'unavailable', string> = {
  overtime: "Overtime isn't covered. nfl4th doesn't compute decisions in overtime, so there are no numbers for it.",
  endgame:
    "With 15 seconds or less left in the game, nfl4th doesn't compute the decision, so there are no numbers for it.",
  unavailable: 'The calculator is unavailable: the model could not be loaded. Reload the page to try again.',
};

/** The page's message for a result with no numbers. */
export function unsupportedView(reason: 'overtime' | 'endgame' | 'unavailable'): CalculatorView {
  return { kind: 'unsupported', message: UNSUPPORTED[reason] };
}

/** The gap between the best two options in points of win probability. */
function marginLine(best: { key: FourthDownCall | TryCall; wp: number }, next: { key: FourthDownCall | TryCall; wp: number } | undefined, tieRule: string): string {
  if (!next) return 'The only option the model considers here.';
  const gap = (best.wp - next.wp) * 100;
  const over = OPTION_NOUN[next.key];
  if (gap === 0) return `Exactly tied with ${over}; ${tieRule}`;
  const size = gap < 0.05 ? 'less than 0.1' : gap.toFixed(1);
  return `By ${size} percentage ${size === '1.0' ? 'point' : 'points'} of win probability over ${over}.`;
}

function linesNote(fallbacks: Fallbacks): string {
  return (
    `A pregame line was left blank, so the model assumed it: a pick'em spread (0) for a missing spread, ` +
    `and ${fallbacks.total.value}, the median total of the ${fallbacks.total.season} season, for a missing total.`
  );
}

/** The 4th down result as the page shows it. */
export function fourthDownView(result: FourthDownResult, fallbacks: Fallbacks): CalculatorView {
  if (!result.supported) return unsupportedView(result.reason);
  // The model's distance is yards plus its own offset; labels use plus 17.
  const fgYards = result.kickDistance - (fallbacks.kickOffset ?? 18) + KICK_LABEL_OFFSET;
  const go = result.breakdown.go.outcomes;
  const fg = result.breakdown.fieldGoal?.outcomes ?? null;

  const options: { key: FourthDownCall; wp: number; parts: Part[] }[] = [
    {
      key: 'go',
      wp: result.wpGo,
      parts: [
        { label: 'Converts', value: pct(go.conversionProb) },
        go.wpIfConvert === null
          ? {
              label: 'Win prob. if converted',
              value: 'n/a',
              note: 'No gain can reach the line to gain from here (4th and more than 65), so there is no converted outcome. The chance to convert is 0.',
            }
          : { label: 'Win prob. if converted', value: pct(go.wpIfConvert) },
        { label: 'Win prob. if stopped', value: pct(go.wpIfFail) },
      ],
    },
  ];
  if (result.wpFieldGoal !== null && fg) {
    options.push({
      key: 'field goal',
      wp: result.wpFieldGoal,
      parts: [
        { label: 'Kick', value: `${fgYards} yards` },
        { label: 'Good', value: pct(fg.makeProb) },
        { label: 'Win prob. if good', value: pct(fg.wpIfMake) },
        { label: 'Win prob. if missed', value: pct(fg.wpIfMiss) },
      ],
    });
  }
  if (result.wpPunt !== null) {
    options.push({ key: 'punt', wp: result.wpPunt, parts: [{ label: 'Averaged over', value: 'where the punt lands' }] });
  }
  // Highest first; an exact tie in the contract's order.
  options.sort((a, b) => b.wp - a.wp || TIE_ORDER.indexOf(a.key) - TIE_ORDER.indexOf(b.key));

  const skipped: { label: string; reason: string }[] = [];
  if (result.wpFieldGoal === null) {
    skipped.push({
      label: OPTION_LABEL['field goal'],
      reason: `A ${fgYards}-yard kick is too long to attempt, so the model leaves the field goal out.`,
    });
  }
  if (result.wpPunt === null) {
    skipped.push({
      label: OPTION_LABEL.punt,
      reason: "nfl4th has no punt outcomes this close to the goal line, so it doesn't consider a punt here.",
    });
  }

  const best = options.find((o) => o.key === result.call) ?? options[0];
  const next = options.find((o) => o !== best);
  return {
    kind: 'result',
    call: OPTION_LABEL[result.call],
    margin: marginLine(best, next, 'an exact tie goes to the first of going for it, a field goal and a punt.'),
    options: options.map((o) => ({
      key: o.key,
      label: o.key === 'field goal' ? `Field goal, ${fgYards} yards` : OPTION_LABEL[o.key],
      wp: pct(o.wp),
      best: o === best,
      parts: o.parts,
    })),
    skipped,
    notes: result.flags.linesUnknown ? [linesNote(fallbacks)] : [],
  };
}

/** The try after a touchdown as the page shows it. */
export function tryView(result: TryResult, fallbacks: Fallbacks): CalculatorView {
  if (!result.supported) return unsupportedView(result.reason);
  const { kick, goForTwo } = result.breakdown;
  const parts = (o: typeof kick.outcomes, words: [string, string, string]): Part[] => [
    { label: words[0], value: pct(o.successProb) },
    { label: `Win prob. if ${words[1]}`, value: pct(o.wpIfSuccess) },
    { label: `Win prob. if ${words[2]}`, value: pct(o.wpIfFail) },
  ];
  const kickOption = { key: 'kick' as const, wp: result.wpKick, parts: parts(kick.outcomes, ['Good', 'good', 'missed']) };
  const twoOption = {
    key: 'go for 2' as const,
    wp: result.wpGoForTwo,
    parts: parts(goForTwo.outcomes, ['Converts', 'converted', 'stopped']),
  };
  // Going for 2 wins an exact tie (nfl4th), so it is listed first on one.
  const options = result.wpKick > result.wpGoForTwo ? [kickOption, twoOption] : [twoOption, kickOption];
  const best = options.find((o) => o.key === result.call) ?? options[0];
  const next = options.find((o) => o !== best);
  return {
    kind: 'result',
    call: OPTION_LABEL[result.call],
    margin: marginLine(best, next, 'an exact tie goes for 2 (nfl4th).'),
    options: options.map((o) => ({ key: o.key, label: OPTION_LABEL[o.key], wp: pct(o.wp), best: o === best, parts: o.parts })),
    skipped: [],
    notes: result.flags.linesUnknown ? [linesNote(fallbacks)] : [],
  };
}
