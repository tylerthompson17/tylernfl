/**
 * The decision grades pages' words and rows, from decisions.json
 * (pipelines/decisions.py, methods in docs/methods/decision-grades.md).
 * What counts as a mistake, the coach totals and their ranks, and the
 * intro's numbers are decided in the pipeline; this file only orders the
 * worst decisions and says things in words.
 */
import type { DecisionsData, FourthDownDecision, TryDecision } from '../../data/types.ts';

export type Decision = FourthDownDecision | TryDecision;

export const isFourthDown = (d: Decision): d is FourthDownDecision => 'yardline100' in d.situation;

const CALL_WORDS: Record<string, string> = {
  go: 'Go for it',
  punt: 'Punt',
  'field goal': 'Field goal',
  kick: 'Extra point',
  'go for 2': 'Go for 2',
};

/** "Go for it", "Extra point". */
export const callWords = (call: string | null): string => (call ? (CALL_WORDS[call] ?? call) : '');

/** A probability as a percent to one place: 0.416 -> "41.6%". */
export const pct = (p: number): string => `${(p * 100).toFixed(1)}%`;

/** Win probability as points to one place: 0.0342 -> "3.4". */
export const points = (wp: number): string => (wp * 100).toFixed(1);

/** "Q3 10:00" from seconds left in the game and in the half (regulation). */
export function clockLine(secondsRemaining: number, halfSecondsRemaining: number): string {
  const firstHalf = secondsRemaining - halfSecondsRemaining >= 900;
  const quarter = (firstHalf ? 1 : 3) + (halfSecondsRemaining > 900 ? 0 : 1);
  const left = halfSecondsRemaining > 900 ? halfSecondsRemaining - 900 : halfSecondsRemaining;
  return `Q${quarter} ${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`;
}

/** "tied", "up 3", "down 7". */
export const scoreWords = (diff: number): string => (diff === 0 ? 'tied' : diff > 0 ? `up ${diff}` : `down ${-diff}`);

/** "own 46", "KC 34", "midfield": where the ball is, from yards to the goal line. */
export function spotWords(yardline100: number, defteam: string): string {
  if (yardline100 === 50) return 'midfield';
  return yardline100 > 50 ? `own ${100 - yardline100}` : `${defteam} ${yardline100}`;
}

/**
 * The situation in a line: "4th and 2 at KC 34, Q3 10:00, up 3";
 * "4th and goal at KC 2, ..."; a try is "After a TD, down 2, Q4 5:00",
 * the score counting the touchdown.
 */
export function situationWords(d: Decision): string {
  const s = d.situation;
  const when = clockLine(s.secondsRemaining, s.halfSecondsRemaining);
  if (!isFourthDown(d)) return `After a TD, ${scoreWords(s.scoreDiff)}, ${when}`;
  const f = d.situation;
  const togo = f.distance === f.yardline100 ? 'goal' : String(f.distance);
  return `4th and ${togo} at ${spotWords(f.yardline100, f.defteam)}, ${when}, ${scoreWords(f.scoreDiff)}`;
}

/** Each option's WP in a fixed order, whichever was chosen: "Go 52.2%, FG 41.3%, Punt 49.3%". */
export function optionWords(d: Decision): string {
  const parts: [string, number | null | undefined][] = isFourthDown(d)
    ? [['Go', d.wpGo], ['FG', d.wpFieldGoal], ['Punt', d.wpPunt]]
    : [['XP', d.wpKick], ['2 pt', d.wpGoForTwo]];
  return parts
    .filter((p): p is [string, number] => typeof p[1] === 'number')
    .map(([label, wp]) => `${label} ${pct(wp)}`)
    .join(', ');
}

/** The auto chart a game's decisions link to (charts/auto.py wp_slug). */
export function chartSlug(d: Decision, season: number): string {
  const { home, posteam, defteam } = d.situation;
  const away = home === posteam ? defteam : posteam;
  return `auto-${season}-week-${d.week}-${away}-at-${home}-win-probability`.toLowerCase();
}

/** "BUF at KC", the game as the chart names it. */
export function gameWords(d: Decision): string {
  const { home, posteam, defteam } = d.situation;
  return `${home === posteam ? defteam : posteam} at ${home}`;
}

export interface WorstRow {
  rank: number;
  decision: Decision;
}

/**
 * The costliest mistakes, 4th downs and tries together, most costly
 * first; equal costs at the displayed precision share a rank and keep
 * game order.
 */
export function worstDecisions(data: DecisionsData, limit: number): { rows: WorstRow[]; total: number } {
  const mistakes = [...data.fourthDowns, ...data.tries].filter((d) => d.graded && d.wpCost !== null);
  mistakes.sort(
    (a, b) =>
      Number(points(b.wpCost!)) - Number(points(a.wpCost!)) || a.gameId.localeCompare(b.gameId) || a.playId - b.playId,
  );
  const rows: WorstRow[] = [];
  let shown = '';
  let rank = 0;
  mistakes.slice(0, limit).forEach((d, i) => {
    if (points(d.wpCost!) !== shown) {
      shown = points(d.wpCost!);
      rank = i + 1;
    }
    rows.push({ rank, decision: d });
  });
  return { rows, total: mistakes.length };
}

/** The intro, from the pipeline's summary; null when there are no mistakes to describe. */
export function introLines(s: DecisionsData['summary']): string[] | null {
  if (!s.fourthDowns || s.nfl4thGoShare === null || s.coachGoShare === null) return null;
  const lines = [
    `nfl4th leans toward going for it. It recommends going on ${pct(s.nfl4thGoShare)} of this season's ` +
      `${s.fourthDowns.toLocaleString('en-US')} evaluated 4th downs; coaches went on ${pct(s.coachGoShare)}.`,
  ];
  if (s.mistakes && s.kicksModelWouldGoShare !== null && s.closeCallShare !== null) {
    lines.push(
      `So most flagged decisions are kicks the model would have gone for: ${s.kicksModelWouldGo} of ${s.mistakes} ` +
        `(${pct(s.kicksModelWouldGoShare)}). They are also the plays where the model is least certain: ` +
        `${pct(s.closeCallShare)} had nfl4th's top two options within ${Number(points(s.closeMargin))} points of win probability.`,
    );
  }
  return lines;
}
