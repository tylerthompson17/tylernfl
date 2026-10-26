/**
 * A game page's words, from its games/{gameId}.json (pipelines/games.py)
 * and its records in decisions.json. Pure, so it runs under Node's test
 * runner; the page only lays these out.
 */
import type { GameBigPlay, GameData, GameTeamBox } from '../../data/types.ts';
import type { LiveGrade } from '../live-fourth/grade.ts';
import { optionWords as liveOptionWords } from '../live-fourth/grade.ts';
import { playSummary, verdictLine, verdictWords } from '../live-fourth/words.ts';
import { callWords, clockLine, isFourthDown, pct, scoreWords, spotWords, type Decision } from '../decisions/view.ts';
import { formatStat } from '../../utils/format.ts';

/** "games/2026/1/ari-at-lac": the page's path under the base. */
export const gamePath = (g: Pick<GameData, 'season' | 'week' | 'away' | 'home'>): string =>
  `games/${g.season}/${g.week}/${g.away.toLowerCase()}-at-${g.home.toLowerCase()}`;

/** The anchor a decision's item carries, which its chart mark links to. */
export const playAnchor = (playId: number): string => `play-${playId}`;

const half = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** "SEA -3", "Pick'em": the closing spread as a sportsbook writes it. */
export function spreadText(g: Pick<GameData, 'away' | 'home' | 'spreadLine'>): string | null {
  if (g.spreadLine === null) return null;
  if (g.spreadLine === 0) return "Pick'em";
  return `${g.spreadLine > 0 ? g.home : g.away} -${half(Math.abs(g.spreadLine))}`;
}

/** "ARI covered by 20.5.", "SEA won by 3: a push." */
export function spreadResult(g: Pick<GameData, 'away' | 'home' | 'awayScore' | 'homeScore' | 'spreadLine'>): string | null {
  if (g.spreadLine === null) return null;
  const over = g.homeScore - g.awayScore - g.spreadLine;
  if (over === 0) return 'A push.';
  return `${over > 0 ? g.home : g.away} covered by ${half(Math.abs(over))}.`;
}

/** "40 points: under by 7.5.", "47 points: a push." */
export function totalResult(g: Pick<GameData, 'awayScore' | 'homeScore' | 'totalLine'>): string | null {
  if (g.totalLine === null) return null;
  const points = g.awayScore + g.homeScore;
  const over = points - g.totalLine;
  if (over === 0) return `${points} points: a push.`;
  return `${points} points: ${over > 0 ? 'over' : 'under'} by ${half(Math.abs(over))}.`;
}

/** Period headings for the line score: 1 to 4, then OT (OT2, ... in the playoffs). */
export const periodLabels = (count: number): string[] =>
  Array.from({ length: count }, (_, i) => (i < 4 ? String(i + 1) : i === 4 ? 'OT' : `OT${i - 3}`));

const rate = (made: number, att: number) => `${made} of ${att}${att ? ` (${pct(made / att)})` : ''}`;
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/** The team box score's rows, in order: label, each side's value, and a note for the label's tooltip. */
export function teamBoxRows(away: GameTeamBox, home: GameTeamBox): { label: string; title?: string; away: string; home: string }[] {
  const row = (label: string, value: (b: GameTeamBox) => string, title?: string) => ({ label, title, away: value(away), home: value(home) });
  return [
    row('Total yards', (b) => String(b.yards), 'Net yards on snaps: passes (sacks counted), runs, kneels and spikes'),
    row('Passing', (b) => String(b.passYards), 'Net, sack yards taken off'),
    row('Rushing', (b) => String(b.rushYards)),
    row('Plays', (b) => String(b.plays)),
    row('Yards per play', (b) => (b.plays ? (b.yards / b.plays).toFixed(1) : '-')),
    row('First downs', (b) => String(b.firstDowns), 'Penalty first downs included'),
    row('EPA per play', (b) => formatStat(b.epaPerPlay, 'signed3'), 'Expected points added per dropback or designed run'),
    row('Success rate', (b) => formatStat(b.successRate, 'percent1'), 'Share of dropbacks and designed runs that added expected points'),
    row('3rd down', (b) => rate(...b.thirdDowns)),
    row('4th down', (b) => rate(...b.fourthDowns)),
    row('Red zone TDs', (b) => rate(...b.redZone), "Drives reaching inside the opponent's 20 that ended in a touchdown"),
    row('Turnovers', (b) => String(b.turnovers), 'Interceptions thrown and fumbles lost'),
    row('Time of possession', (b) => clock(b.timeOfPossession)),
  ];
}

/** "2:00" from nflverse's "02:00". */
export const clockText = (c: string): string => c.replace(/^0(\d)/, '$1');

/** "Q2 13:37", "OT 6:10". */
export const quarterClock = (quarter: number, c: string): string => `${quarter > 4 ? 'OT' : `Q${quarter}`} ${clockText(c)}`;

/** The play's description without nflverse's leading clock: "(13:37) (Shotgun) ..." -> "(Shotgun) ...". */
export const playText = (description: string): string => description.replace(/^\(\s*\d*:\d\d\)\s*/, '');

/** Which team the play helped, how much, and that team's chance before and after: "ARI", "12.7", "32.3% to 45.0%". */
export function swingOf(p: GameBigPlay, g: Pick<GameData, 'away' | 'home'>): { team: string; points: string; wp: string } {
  const homeGained = p.homeWpAfter >= p.homeWpBefore;
  const before = homeGained ? p.homeWpBefore : 1 - p.homeWpBefore;
  const after = homeGained ? p.homeWpAfter : 1 - p.homeWpAfter;
  return {
    team: homeGained ? g.home : g.away,
    points: ((after - before) * 100).toFixed(1),
    wp: `${pct(before)} to ${pct(after)}`,
  };
}

/** A decision as the live items show it, from decisions.json (build time). */
export interface DecisionItem {
  anchor: string;
  playId: number;
  /** "Q2 4:41" */
  when: string;
  /** "ARI 4th and 4 at LAC 36, tied" */
  down: string;
  /** "Missed a 54-yard field goal" */
  play: string;
  /** nflverse's text, for the tooltip */
  description: string;
  verdict: string;
  /** Each option's WP; null when there are no numbers */
  wp: string | null;
  questionable: boolean;
  /** Questionable with nfl4th's top two options closeMargin or more apart */
  clear: boolean;
  fourthDown: boolean;
}

const UNSUPPORTED: Record<string, string> = {
  overtime: "Not graded: nfl4th doesn't compute overtime.",
  endgame: "Not graded: nfl4th doesn't compute the last 15 seconds.",
  unavailable: 'No numbers: the model could not run this situation.',
};

function whenOf(d: Decision): string {
  const s = d.situation;
  if (s.overtime) return `OT ${Math.floor(s.halfSecondsRemaining / 60)}:${String(Math.floor(s.halfSecondsRemaining % 60)).padStart(2, '0')}`;
  return clockLine(s.secondsRemaining, s.halfSecondsRemaining);
}

/** "Extra point good", "Converted the two-point try with a pass", from nflverse's text. */
export function trySummary(teamCall: 'kick' | 'go for 2', text: string): string {
  if (teamCall === 'kick') {
    if (/blocked/i.test(text)) return 'Extra point blocked';
    if (/is good/i.test(text)) return 'Extra point good';
    if (/no good|aborted/i.test(text)) return 'Extra point missed';
    return 'Kicked the extra point';
  }
  const how = /\bpass\b/i.test(text) ? 'pass' : 'run';
  if (/attempt succeeds/i.test(text)) return `Converted the two-point try with a ${how}`;
  if (/attempt fails/i.test(text)) return `Two-point try failed on a ${how}`;
  return 'Went for 2';
}

export function decisionItem(d: Decision, closeMargin: number): DecisionItem {
  const s = d.situation;
  const base = { anchor: playAnchor(d.playId), playId: d.playId, when: whenOf(d), description: d.description };
  const questionable = d.graded;
  const clear = questionable && (d.margin ?? 0) >= closeMargin;
  const unsupported = d.call === null || d.margin === null || d.margin === undefined;
  const decided = d.skip === 'decided' ? ' The game was already decided, so it is not graded.' : '';
  if (isFourthDown(d)) {
    const f = d.situation;
    const togo = f.distance === f.yardline100 ? 'goal' : String(f.distance);
    const down = `${f.posteam} 4th and ${togo} at ${spotWords(f.yardline100, f.defteam)}, ${scoreWords(f.scoreDiff)}`;
    const play = playSummary('', d.description, f.distance, d.teamCall, d.fake);
    if (unsupported) {
      return { ...base, down, play, verdict: UNSUPPORTED[d.skip ?? 'unavailable'] ?? UNSUPPORTED.unavailable, wp: null, questionable, clear, fourthDown: true };
    }
    const grade: Extract<LiveGrade, { kind: 'graded' }> = {
      kind: 'graded',
      call: d.call as Extract<LiveGrade, { kind: 'graded' }>['call'],
      wpGo: d.wpGo ?? 0,
      wpFieldGoal: d.wpFieldGoal ?? null,
      wpPunt: d.wpPunt ?? null,
      wpLost: d.wpCost,
      questionable,
      clear,
      decided: d.skip === 'decided',
      margin: d.margin!,
    };
    return {
      ...base,
      down,
      play,
      verdict: verdictLine(grade, d.teamCall) + (decided ? `.${decided}` : ''),
      wp: liveOptionWords(grade, f.yardline100),
      questionable,
      clear,
      fourthDown: true,
    };
  }
  const down = `${s.posteam} try after a touchdown, ${scoreWords(s.scoreDiff)}`;
  const play = trySummary(d.teamCall, d.description);
  if (unsupported) {
    return { ...base, down, play, verdict: UNSUPPORTED[d.skip ?? 'unavailable'] ?? UNSUPPORTED.unavailable, wp: null, questionable, clear, fourthDown: false };
  }
  const options: [string, number | null | undefined][] = [['Extra point', d.wpKick], ['Go for 2', d.wpGoForTwo]];
  return {
    ...base,
    down,
    play,
    verdict: verdictWords(callWords(d.call), d.teamCall === d.call, d.margin!, d.wpCost) + (decided ? `.${decided}` : ''),
    wp: options.filter((o): o is [string, number] => typeof o[1] === 'number').map(([l, v]) => `${l} ${pct(v)}`).join('; '),
    questionable,
    clear,
    fourthDown: false,
  };
}

/** "4th down, Q2 4:41: ARI 4th and 4 at LAC 36. Questionable call.": a chart mark's name. */
export const markLabel = (item: DecisionItem): string =>
  `${item.fourthDown ? '4th down' : 'Try'}, ${item.when}: ${item.down}. ${item.play}.${item.questionable ? ' Questionable call.' : ''}`;
