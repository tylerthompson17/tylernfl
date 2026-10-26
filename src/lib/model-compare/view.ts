/**
 * The experimental model next to nfl4th, as words and numbers ready to show
 * (contract v5, docs/model-interface.md "Experimental model"): each model's
 * call and margin, every option's win probability under both, whether they
 * disagree, the label and dataAsOf, the flags in words, and the experimental
 * model's per-term breakdown in points of win probability.
 *
 * It reads anything shaped like a result: a live recommend() result or a
 * stored decisions.json record, which carry the same fields. Terms and
 * changed inputs are rendered from their own labels, with no mapping here,
 * so a new term needs no change. Pure; html.ts turns a view into markup,
 * at build time and in the browser alike.
 *
 * Only per-play numbers: no outcomes, accuracy, records or WP-cost tallies
 * (the contract's "What pages may show").
 */
import type { ExperimentalResult, FourthDownCall, OptionKey } from '../fourth-down.ts';
import { KICK_LABEL_OFFSET } from '../field/strip.ts';

/** The fields a comparison reads; a recommend() result and a decisions.json record both have them. */
export interface Comparable {
  call: FourthDownCall;
  wpGo: number;
  wpPunt: number | null;
  wpFieldGoal: number | null;
  kickDistance: number;
  experimental?: ExperimentalResult;
}

export interface CompareOptions {
  /** The offense, for the flags' words */
  team: string;
  /** nfl4th's kick distance offset (the manifest's kickDistanceOffset, 18) */
  kickOffset: number;
  /** The season the experimental tables are for, named when a situation is outside it */
  tablesSeason?: number;
}

export interface CallView {
  /** "Go for it" */
  call: string;
  /** "By 2.9 points over a punt", "The only option" */
  margin: string;
}

export interface OptionRow {
  key: OptionKey;
  /** "Go for it", "Field goal, 52 yards" */
  label: string;
  experimental: string;
  nfl4th: string;
  /** Experimental minus nfl4th, in points: "+0.56" */
  difference: string;
  bestExperimental: boolean;
  bestNfl4th: boolean;
}

export interface BreakdownCell {
  /** "+0.56", a term's not applicable text, or '' when the term cannot move this option */
  value: string;
  /** A term that does not apply here (its text shows dimmed) */
  muted: boolean;
}

export interface BreakdownView {
  /** The options, in the table's column order */
  columns: { key: OptionKey; label: string }[];
  /** Every option's WP with every term off, which is nfl4th's */
  start: string[];
  terms: { id: string; label: string; cells: BreakdownCell[] }[];
  residual: string[];
  /** The experimental model's WP for each option */
  end: string[];
  /** "Conversion chance: nfl4th 52.4%, experimental 56.7%" */
  changed: string[];
}

export type ComparisonView =
  | { kind: 'unsupported'; message: string }
  | {
      kind: 'nfl4th-only';
      nfl4th: CallView;
      options: OptionRow[];
      /** Why the experimental model has no numbers */
      message: string;
    }
  | {
      kind: 'both';
      experimental: CallView;
      nfl4th: CallView;
      disagree: boolean;
      options: OptionRow[];
      label: string;
      /** "Weekly tables through 2026 week 6." */
      asOf: string;
      notes: string[];
      breakdown: BreakdownView;
    };

const CALL_WORDS: Record<FourthDownCall, string> = { go: 'Go for it', 'field goal': 'Field goal', punt: 'Punt' };
const CALL_NOUN: Record<FourthDownCall, string> = { go: 'going for it', 'field goal': 'a field goal', punt: 'a punt' };
const KEY_CALL: Record<OptionKey, FourthDownCall> = { go: 'go', fieldGoal: 'field goal', punt: 'punt' };
/** Column order, and the contract's tie order: go, then field goal, then punt. */
const KEYS: OptionKey[] = ['go', 'fieldGoal', 'punt'];

/** A probability as a percent to one place: 0.4546 -> "45.5%". */
export const pct = (p: number): string => `${(p * 100).toFixed(1)}%`;

/** A WP change in points to two places, signed: 0.00557 -> "+0.56"; under 0.005 points is "0.00". */
export function signedPoints(delta: number): string {
  const points = delta * 100;
  if (Math.abs(points) < 0.005) return '0.00';
  return `${points > 0 ? '+' : '-'}${Math.abs(points).toFixed(2)}`;
}

type Wps = Record<OptionKey, number | null>;

function callView(call: FourthDownCall, wps: Wps): CallView {
  const best = wps[keyOf(call)]!;
  const others = KEYS.filter((k) => k !== keyOf(call) && wps[k] !== null).sort((a, b) => wps[b]! - wps[a]!);
  if (!others.length) return { call: CALL_WORDS[call], margin: 'The only option the model considers here.' };
  const next = others[0];
  const gap = (best - wps[next]!) * 100;
  const size = gap === 0 ? null : gap < 0.05 ? 'less than 0.1' : gap.toFixed(1);
  const margin = size === null ? `Exactly tied with ${CALL_NOUN[KEY_CALL[next]]}` : `By ${size} ${size === '1.0' ? 'point' : 'points'} over ${CALL_NOUN[KEY_CALL[next]]}`;
  return { call: CALL_WORDS[call], margin };
}

const keyOf = (call: FourthDownCall): OptionKey => (call === 'field goal' ? 'fieldGoal' : call);

function optionLabel(key: OptionKey, r: Comparable, kickOffset: number): string {
  if (key !== 'fieldGoal') return CALL_WORDS[KEY_CALL[key]];
  return `Field goal, ${r.kickDistance - kickOffset + KICK_LABEL_OFFSET} yards`;
}

function rows(r: Comparable, nfl4th: Wps, experimental: Wps | null, kickOffset: number): OptionRow[] {
  return KEYS.filter((k) => nfl4th[k] !== null).map((key) => {
    const n = nfl4th[key]!;
    const e = experimental?.[key] ?? null;
    return {
      key,
      label: optionLabel(key, r, kickOffset),
      experimental: e === null ? '' : pct(e),
      nfl4th: pct(n),
      difference: e === null ? '' : signedPoints(e - n),
      bestExperimental: experimental !== null && r.experimental?.supported === true && keyOf(r.experimental.call) === key,
      bestNfl4th: keyOf(r.call) === key,
    };
  });
}

function changedLine(c: { label: string; unit: 'probability' | 'yards'; nfl4th: number; experimental: number }): string {
  const value = (v: number) => (c.unit === 'probability' ? pct(v) : `${v.toFixed(1)} ${Math.abs(v) === 1 ? 'yard' : 'yards'}`);
  return `${c.label}: nfl4th ${value(c.nfl4th)}, experimental ${value(c.experimental)}`;
}

/** The experimental model's term table: every term against every option it can move, in WP points. */
export function breakdownView(e: Extract<ExperimentalResult, { supported: true }>, r: Comparable, kickOffset: number): BreakdownView {
  const keys = KEYS.filter((k) => e.options[k] !== null);
  const option = (k: OptionKey) => e.options[k]!;
  return {
    columns: keys.map((key) => ({ key, label: optionLabel(key, r, kickOffset) })),
    start: keys.map((k) => pct(option(k).wpAllTermsOff)),
    terms: e.terms.map((t) => ({
      id: t.id,
      label: t.label,
      cells: keys.map((k) => {
        if (!t.options.includes(k)) return { value: '', muted: false };
        if (!t.applies) return { value: t.notApplicableText ?? 'Does not apply', muted: true };
        return { value: signedPoints(t.wpDelta[k] ?? 0), muted: false };
      }),
    })),
    residual: keys.map((k) => signedPoints(option(k).residual)),
    end: keys.map((k) => pct(option(k).wp)),
    changed: keys.flatMap((k) => option(k).changedInputs.map(changedLine)),
  };
}

function flagNotes(e: Extract<ExperimentalResult, { supported: true }>, team: string): string[] {
  const notes: string[] = [];
  if (e.flags.punterUnknown) notes.push(`No punter was found for ${team}, so the experimental model used a league-average punter.`);
  if (e.flags.punterNoHistory) notes.push("The punter has no punts in the experimental model's fit seasons, so it used a league-average punter.");
  if (e.flags.coverageNoHistory) notes.push(`${team} has no punt coverage history in the experimental model's fit seasons, so that part is league average.`);
  return notes;
}

const UNSUPPORTED: Record<'overtime' | 'endgame' | 'unavailable', string> = {
  overtime: "Overtime isn't covered. nfl4th doesn't compute decisions in overtime, so neither model has numbers for it.",
  endgame: "With 15 seconds or less left in the game, nfl4th doesn't compute the decision, so neither model has numbers for it.",
  unavailable: 'The calculator is unavailable: the model could not be loaded. Reload the page to try again.',
};

/** The page's message when neither model has numbers. */
export function unsupportedComparison(reason: 'overtime' | 'endgame' | 'unavailable'): ComparisonView {
  return { kind: 'unsupported', message: UNSUPPORTED[reason] };
}

/** The two models on one situation, experimental first. */
export function comparisonView(r: Comparable, opts: CompareOptions): ComparisonView {
  const nfl4th: Wps = { go: r.wpGo, fieldGoal: r.wpFieldGoal, punt: r.wpPunt };
  const e = r.experimental;
  if (!e || !e.supported) {
    const message =
      e?.supported === false && e.reason === 'season'
        ? `The experimental model's tables are for the ${opts.tablesSeason ?? 'current'} season only, so it has no numbers for this one.`
        : 'The experimental model has no numbers here: its files could not be loaded.';
    return { kind: 'nfl4th-only', nfl4th: callView(r.call, nfl4th), options: rows(r, nfl4th, null, opts.kickOffset), message };
  }
  const experimental: Wps = { go: e.wpGo, fieldGoal: e.wpFieldGoal, punt: e.wpPunt };
  return {
    kind: 'both',
    experimental: callView(e.call, experimental),
    nfl4th: callView(r.call, nfl4th),
    disagree: e.call !== r.call,
    options: rows(r, nfl4th, experimental, opts.kickOffset),
    label: e.label,
    asOf: `Weekly tables through ${e.dataAsOf.season} week ${e.dataAsOf.week}.`,
    notes: flagNotes(e, opts.team),
    breakdown: breakdownView(e, r, opts.kickOffset),
  };
}
