/**
 * Preliminary grades for today's 4th downs on the live page: the situation
 * from the summary (summary.ts), nfl4th's numbers for it, and what the
 * team's choice cost against nfl4th's recommendation. The final grades are
 * the daily pipeline's (pipelines/decisions.py), from nflverse play-by-play;
 * this follows its rules where it can today:
 * - the cost is the recommendation's WP minus the choice's, at the snap;
 * - a mistake costs 0.02 or more; a clear one has nfl4th's top two options
 *   0.05 or more apart;
 * - fakes count as going for it;
 * - not graded: overtime and the last 15 seconds (nfl4th computes neither),
 *   a choice the model leaves out, and a game already decided (every option
 *   under 2% or every one over 98%).
 * Not yet (this week): a delay of game before a kick graded at the spot
 * before it. Timeouts are the scoreboard's when the page saw the 4th down
 * live, else counted from the summary's timeout plays (summary.ts).
 */
import type { FourthDownResult, FourthDownSituation } from '../fourth-down.ts';
import { clockSeconds, parseClock } from '../calculator/form.ts';
import { pct } from '../calculator/format.ts';
import { scoreWords, spotWords } from '../decisions/view.ts';
import type { LiveGameInfo } from './situation.ts';
import type { SummaryFourthDown } from './summary.ts';
import { callOf, type TeamCall } from './tracker.ts';

export const MISTAKE = 0.02;
export const CLEAR = 0.05;
const DECIDED_LOW = 0.02;
const DECIDED_HIGH = 0.98;

export interface Timeouts {
  offense: number;
  defense: number;
}

/** The contract situation for a summary 4th down; null when the clock cannot be read. */
export function situationFromSummary(
  d: SummaryFourthDown,
  homeId: string,
  game: LiveGameInfo,
  timeouts: Timeouts | null,
): FourthDownSituation | null {
  const clock = parseClock(d.clock);
  if (clock === null) return null;
  const homeBall = d.teamId === homeId;
  const overtime = d.period > 4;
  const time = overtime ? { game: 0, half: 0 } : clockSeconds(d.period, clock);
  const own = homeBall ? d.homeScore : d.awayScore;
  const their = homeBall ? d.awayScore : d.homeScore;
  return {
    season: game.season,
    posteam: homeBall ? game.home : game.away,
    defteam: homeBall ? game.away : game.home,
    home: game.home,
    yardline100: d.yardline100,
    distance: d.distance,
    overtime,
    secondsRemaining: time.game,
    halfSecondsRemaining: time.half,
    scoreDiff: own - their,
    timeoutsOffense: timeouts?.offense ?? (homeBall ? d.homeTimeouts : d.awayTimeouts),
    timeoutsDefense: timeouts?.defense ?? (homeBall ? d.awayTimeouts : d.homeTimeouts),
    // Not on the scoreboard or in the summary; matters only in the first half.
    homeOpeningKickoff: true,
    // Null only for an upcoming retractable roof; nfl4th treats open and closed alike.
    roof: game.roof ?? 'closed',
    temp: null,
    spreadLine: game.spreadLine,
    totalLine: game.totalLine,
  };
}

export type LiveGrade =
  | { kind: 'unsupported'; message: string }
  | {
      kind: 'graded';
      call: TeamCall;
      wpGo: number;
      wpFieldGoal: number | null;
      wpPunt: number | null;
      /** Null when the team's choice is one the model leaves out */
      wpLost: number | null;
      /** wpLost of 0.02 or more, in a game not already decided */
      questionable: boolean;
      /** Questionable, with nfl4th's top two options 0.05 or more apart */
      clear: boolean;
      decided: boolean;
      /** WP between nfl4th's top two options */
      margin: number;
    };

/** What the team did, from the summary play. */
export function teamCallOf(d: SummaryFourthDown): { call: TeamCall | null; fake: boolean } {
  return callOf({ id: d.id, type: d.type, text: d.text, start: { yardLine: null, team: d.teamId } });
}

export function gradeOf(result: FourthDownResult, teamCall: TeamCall | null): LiveGrade {
  if (!result.supported) {
    const why = {
      overtime: "Not graded: nfl4th doesn't compute overtime.",
      endgame: "Not graded: nfl4th doesn't compute the last 15 seconds.",
      unavailable: 'No numbers: the model could not run this situation.',
    } as const;
    return { kind: 'unsupported', message: why[result.reason] };
  }
  const wps: Record<TeamCall, number | null> = { go: result.wpGo, 'field goal': result.wpFieldGoal, punt: result.wpPunt };
  const options = Object.values(wps).filter((v): v is number => v !== null);
  const ranked = [...options].sort((a, b) => b - a);
  const margin = ranked.length > 1 ? ranked[0] - ranked[1] : 0;
  const decided = options.every((v) => v < DECIDED_LOW) || options.every((v) => v > DECIDED_HIGH);
  const chosen = teamCall ? wps[teamCall] : null;
  const wpLost = chosen === null ? null : wps[result.call]! - chosen;
  const questionable = !decided && wpLost !== null && wpLost >= MISTAKE;
  return {
    kind: 'graded',
    call: result.call,
    wpGo: result.wpGo,
    wpFieldGoal: result.wpFieldGoal,
    wpPunt: result.wpPunt,
    wpLost,
    questionable,
    clear: questionable && margin >= CLEAR,
    decided,
    margin,
  };
}

const CALL_WORDS: Record<TeamCall, string> = { go: 'Go for it', punt: 'Punt', 'field goal': 'Field goal' };
const DID_WORDS: Record<TeamCall, string> = { go: 'Went for it', punt: 'Punted', 'field goal': 'Kicked a field goal' };

export const callWords = (call: TeamCall): string => CALL_WORDS[call];

/** "Went for it", "Went for it (a fake)", or the play type when it is not a call. */
export function didWords(d: SummaryFourthDown): string {
  const { call, fake } = teamCallOf(d);
  return call ? `${DID_WORDS[call]}${fake ? ' (a fake)' : ''}` : d.type;
}

/** "NO 4th and 2 at PIT 44, down 7" from the offense's side. */
export function situationWords(d: SummaryFourthDown, homeId: string, game: LiveGameInfo): string {
  const homeBall = d.teamId === homeId;
  const offense = homeBall ? game.home : game.away;
  const defense = homeBall ? game.away : game.home;
  const own = homeBall ? d.homeScore : d.awayScore;
  const their = homeBall ? d.awayScore : d.homeScore;
  const togo = d.distance === d.yardline100 ? 'goal' : String(d.distance);
  return `${offense} 4th and ${togo} at ${spotWords(d.yardline100, defense)}, ${scoreWords(own - their)}`;
}

/** "Q2 4:41", "OT 6:10". */
export const clockWords = (d: SummaryFourthDown): string => (d.period > 4 ? `OT ${d.clock}` : `Q${d.period} ${d.clock}`);

/** "Go 52.0%, FG 41.3%, Punt 49.1%": every option the model considers, fixed order. */
export function optionWords(g: Extract<LiveGrade, { kind: 'graded' }>): string {
  const parts: [string, number | null][] = [['Go', g.wpGo], ['FG', g.wpFieldGoal], ['Punt', g.wpPunt]];
  return parts.filter((p): p is [string, number] => p[1] !== null).map(([l, v]) => `${l} ${pct(v)}`).join(', ');
}
