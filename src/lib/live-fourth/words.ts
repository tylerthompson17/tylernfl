/**
 * The live 4th down items' words, the same on the home panel, the live
 * page and team pages:
 * - a short plain summary of the play ("Punted 54 yards", "Missed a
 *   52-yard field goal", "Converted with a 9-yard pass"), read from ESPN's
 *   play text, never the text itself;
 * - a verdict against nfl4th: "Agreed with nfl4th: Punt (by 4.7 points)",
 *   "Went against nfl4th: it said Go for it (by 3.1 points)", or "A close
 *   call" when nfl4th's top two options are under 0.02 apart;
 * - for a 4th down still to be played: "nfl4th says: Go for it, by 3.1
 *   points. Waiting for the snap.", or "A close call (nfl4th leans Punt, by
 *   0.1 points)" under 0.02;
 * - a muffed punt says so: "Punted 36 yards, muffed, recovered by TB";
 * - which punter the experimental model assumed when none was given (live
 *   items never give one): "Experimental model: assumed KC's most recent
 *   punter, Punter (M. Araiza)." with the punter term's label as is, or "a
 *   league-average punter" when it found none.
 * "By" is points of win probability: for an agreed call, how far ahead
 * nfl4th's choice was of the next option; for one against it, what the
 * team's choice gave up.
 */
import type { FourthDownResult, FourthDownSituation } from '../fourth-down.ts';
import type { LiveGrade } from './grade.ts';
import { callWords } from './grade.ts';
import type { TeamCall } from './tracker.ts';

/** Under this gap between nfl4th's top two options, a call is close either way. */
export const CLOSE = 0.02;

const yardsIn = (text: string): number | null => {
  if (/for no gain/i.test(text)) return 0;
  const m = /for (-?\d+) yards?/i.exec(text);
  return m ? Number(m[1]) : null;
};

const plural = (n: number) => `${n} ${Math.abs(n) === 1 ? 'yard' : 'yards'}`;

/** "a 9-yard", "an 11-yard", "an 8-yard": numbers said with a vowel sound take an. */
export const aYards = (n: number): string => `${n === 8 || n === 11 || n === 18 || (n >= 80 && n <= 89) ? 'an' : 'a'} ${n}-yard`;

/**
 * A short plain summary of what happened on a 4th down, from ESPN's play
 * type and text. `distance` is the yards needed, for converted or not.
 */
export function playSummary(type: string, text: string, distance: number, call: TeamCall | null, fake: boolean): string {
  const t = type.toLowerCase();
  const fakeWord = fake ? 'Fake: ' : '';
  if (call === 'punt' || t.includes('punt')) {
    if (/blocked/i.test(text) || t.includes('blocked')) return 'Punt blocked';
    const m = /punts (\d+) yards?/i.exec(text);
    const punted = m ? `Punted ${m[1]} yards` : 'Punted';
    if (!/muffs/i.test(text) && !t.includes('muff')) return punted;
    const by = /recovered by ([A-Z]{2,4})-/i.exec(text);
    return `${punted}, muffed${by ? `, recovered by ${by[1]}` : ''}`;
  }
  if (call === 'field goal' || t.includes('field goal')) {
    const m = /(\d+) yard field goal/i.exec(text);
    const kick = m ? `${aYards(Number(m[1]))} field goal` : 'a field goal';
    if (/blocked/i.test(text) || t.includes('blocked')) return `${kick.charAt(0).toUpperCase()}${kick.slice(1)} blocked`;
    return /is good/i.test(text) || t.includes('good') ? `Made ${kick}` : `Missed ${kick}`;
  }
  if (/intercepted/i.test(text) || t.includes('interception')) return `${fakeWord}Stopped: intercepted`;
  if (/fumbles/i.test(text) && /recovered by/i.test(text) && !/touchdown/i.test(text)) return `${fakeWord}Fumbled`;
  const sacked = t === 'sack' || /sacked/i.test(text);
  const pass = /\bpass\b/i.test(text) || t.startsWith('pass');
  const yards = yardsIn(text);
  if (sacked) return `${fakeWord}Stopped: sacked${yards !== null && yards < 0 ? ` for a loss of ${plural(-yards)}` : ''}`;
  if (/incomplete/i.test(text)) return `${fakeWord}Stopped: incomplete pass`;
  const how = pass ? 'pass' : 'run';
  if (/touchdown/i.test(text)) return `${fakeWord}Touchdown on ${yards !== null ? `${aYards(yards)} ` : 'a '}${how}`;
  if (yards === null) return `${fakeWord}Went for it`;
  if (yards >= distance) return `${fakeWord}Converted with ${aYards(yards)} ${how}`;
  return `${fakeWord}Stopped: ${yards > 0 ? `${aYards(yards)} ${how}` : yards === 0 ? `no gain on a ${how}` : `a loss of ${plural(-yards)} on a ${how}`}, short of the line`;
}

// Under 0.05 points the margin rounds to 0.0, which reads as no lean at all.
const by = (wp: number) => (wp < 0.0005 ? 'less than 0.1 points' : `${(wp * 100).toFixed(1)} points`);

/**
 * The verdict in words, given nfl4th's call already said ("Punt", "Go for
 * 2"); shared with the game pages' tries, which have no LiveGrade. A close
 * margin between nfl4th's top two options makes it a close call, unless
 * the team took neither and gave up CLOSE or more (its third option): that
 * is going against nfl4th, however close the top two were.
 */
export function verdictWords(said: string, agreed: boolean, margin: number, wpLost: number | null): string {
  const lostMuch = !agreed && wpLost !== null && wpLost >= CLOSE;
  if (margin < CLOSE && !lostMuch) return `A close call (nfl4th leaned ${said}, by ${by(margin)})`;
  if (agreed) return `Agreed with nfl4th: ${said} (by ${by(margin)})`;
  const lost = wpLost === null ? '' : ` (by ${by(wpLost)})`;
  return `Went against nfl4th: it said ${said}${lost}`;
}

/** The verdict against nfl4th for a 4th down that was played. */
export function verdictLine(grade: LiveGrade, teamCall: TeamCall | null): string {
  if (grade.kind === 'unsupported') return grade.message;
  return verdictWords(callWords(grade.call), teamCall === grade.call, grade.margin, grade.wpLost);
}

/** For a 4th down still to be played. */
export function pendingLine(grade: LiveGrade): string {
  if (grade.kind === 'unsupported') return `${grade.message} Waiting for the snap.`;
  if (grade.margin < CLOSE) return `A close call (nfl4th leans ${callWords(grade.call)}, by ${by(grade.margin)}). Waiting for the snap.`;
  return `nfl4th says: ${callWords(grade.call)}, by ${by(grade.margin)}. Waiting for the snap.`;
}

/**
 * The punter the experimental model fell back on, or null: no punt option,
 * a punterId given, or no supported experimental result.
 */
export function punterLine(result: FourthDownResult | undefined, situation: FourthDownSituation): string | null {
  if (!result?.supported || result.wpPunt === null || situation.punterId) return null;
  const x = result.experimental;
  if (!x.supported) return null;
  if (x.flags.punterUnknown) {
    return `Experimental model: no ${situation.posteam} punter found, so it assumed a league-average punter.`;
  }
  const term = x.terms.find((t) => t.id === 'punter');
  return term ? `Experimental model: assumed ${situation.posteam}'s most recent punter, ${term.label}.` : null;
}
