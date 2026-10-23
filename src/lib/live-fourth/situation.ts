/**
 * A live 4th down (tracker.ts) in words for the home page's panel, and as
 * the contract situation the model needs when the visitor asks for win
 * probabilities. Lines and roof come from schedule.json, embedded in the
 * page; ESPN supplies only the game state.
 */
import type { FourthDownResult, FourthDownSituation, Roof } from '../fourth-down.ts';
import { clockSeconds, parseClock } from '../calculator/form.ts';
import { pct } from '../calculator/format.ts';
import { scoreWords, spotWords } from '../decisions/view.ts';
import { yardline100 } from './snapshot.ts';
import type { LiveFourthDown } from './tracker.ts';

/** What the page embeds per ESPN event id, from ticker.json and schedule.json. */
export interface LiveGameInfo {
  season: number;
  away: string;
  home: string;
  /** Points the home team is favored by, as schedule.json has it */
  spreadLine: number | null;
  totalLine: number | null;
  roof: Roof | null;
}

/**
 * Who received the opening kickoff is not on the scoreboard. The numbers
 * assume the home team did; it only matters in the first half, and the
 * panel says so.
 */
export const ASSUMED_HOME_OPENING_KICKOFF = true;

/**
 * schedule.json's roof is null only for upcoming games at retractable roof
 * stadiums, decided on game day. nfl4th treats open and closed alike, so
 * "closed" gives exactly the numbers either would.
 */
const UNKNOWN_ROOF: Roof = 'closed';

function sides(d: LiveFourthDown, game: LiveGameInfo) {
  const b = d.before;
  const homeBall = b.possession === b.homeId;
  return {
    offense: homeBall ? game.home : game.away,
    defense: homeBall ? game.away : game.home,
    homeBall,
    yl: yardline100(b.yardLine, b.possession, b.homeId),
  };
}

/** The contract situation, or null when the poll lacks something it needs. */
export function situationOf(d: LiveFourthDown, game: LiveGameInfo): FourthDownSituation | null {
  const b = d.before;
  const { offense, defense, homeBall, yl } = sides(d, game);
  const clock = parseClock(b.clock);
  if (yl === null || b.distance === null || clock === null || b.homeScore === null || b.awayScore === null) return null;
  const overtime = b.period > 4;
  const time = overtime ? { game: 0, half: 0 } : clockSeconds(Math.max(1, b.period), clock);
  const own = homeBall ? b.homeScore : b.awayScore;
  const their = homeBall ? b.awayScore : b.homeScore;
  return {
    season: game.season,
    posteam: offense,
    defteam: defense,
    home: game.home,
    yardline100: yl,
    distance: b.distance,
    overtime,
    secondsRemaining: time.game,
    halfSecondsRemaining: time.half,
    scoreDiff: own - their,
    timeoutsOffense: (homeBall ? b.homeTimeouts : b.awayTimeouts) ?? 3,
    timeoutsDefense: (homeBall ? b.awayTimeouts : b.homeTimeouts) ?? 3,
    homeOpeningKickoff: ASSUMED_HOME_OPENING_KICKOFF,
    roof: game.roof ?? UNKNOWN_ROOF,
    temp: null,
    spreadLine: game.spreadLine,
    totalLine: game.totalLine,
  };
}

export interface LiveWords {
  /** "CHI" */
  team: string;
  /** "NE at CHI" */
  game: string;
  /** "4th and 2 at NE 43" */
  down: string;
  /** "Q4 9:40", "OT 8:12" */
  clock: string;
  /** "CHI up 6, 20 to 14" */
  score: string;
  /** "Timeouts: CHI 2, NE 3" */
  timeouts: string;
  /** "Waiting for the snap.", "Went for it", "Outcome not seen." */
  status: string;
  /** ESPN's text of the play that answered it, when one did */
  play: string | null;
}

const CALL_DONE = { go: 'Went for it', punt: 'Punted', 'field goal': 'Kicked a field goal' } as const;

export function liveWords(d: LiveFourthDown, game: LiveGameInfo): LiveWords {
  const b = d.before;
  const { offense, defense, homeBall, yl } = sides(d, game);
  const togo = yl !== null && b.distance === yl ? 'goal' : String(b.distance ?? '');
  const own = (homeBall ? b.homeScore : b.awayScore) ?? 0;
  const their = (homeBall ? b.awayScore : b.homeScore) ?? 0;
  const o = d.outcome;
  let status: string;
  let play: string | null = null;
  if (o.kind === 'pending') status = 'Waiting for the snap.';
  else if (o.kind === 'not seen') {
    status = "Outcome not seen: the scoreboard moved past this play before it showed it.";
  } else {
    status = o.call ? `${CALL_DONE[o.call]}${o.fake ? ' (a fake)' : ''}:` : `${o.play.type || 'Play'}:`;
    play = o.play.text;
  }
  return {
    team: offense,
    game: `${game.away} at ${game.home}`,
    down: `4th and ${togo} at ${yl === null ? '?' : spotWords(yl, defense)}`,
    clock: b.period > 4 ? `OT ${b.clock}` : `Q${b.period} ${b.clock}`,
    score: `${offense} ${scoreWords(own - their)}, ${own} to ${their}`,
    timeouts: `Timeouts: ${offense} ${(homeBall ? b.homeTimeouts : b.awayTimeouts) ?? '?'}, ${defense} ${
      (homeBall ? b.awayTimeouts : b.homeTimeouts) ?? '?'
    }`,
    status,
    play,
  };
}

export interface OptionRow {
  label: string;
  /** "52.2%", or why there is none */
  value: string;
}

/**
 * Each option's win probability in a fixed order, go, field goal, punt,
 * whichever is highest: the panel gives no verdict. Null when there are no
 * numbers, with the reason.
 */
export function optionRows(result: FourthDownResult): { rows: OptionRow[] } | { message: string } {
  if (!result.supported) {
    const why = {
      overtime: "nfl4th doesn't compute decisions in overtime.",
      endgame: "nfl4th doesn't compute decisions with 15 seconds or less left.",
      unavailable: 'The model could not give numbers for this play.',
    } as const;
    return { message: why[result.reason] };
  }
  return {
    rows: [
      { label: 'Go for it', value: pct(result.wpGo) },
      { label: 'Field goal', value: result.wpFieldGoal === null ? `too long (${result.kickDistance} yards)` : pct(result.wpFieldGoal) },
      { label: 'Punt', value: result.wpPunt === null ? 'not considered this close' : pct(result.wpPunt) },
    ],
  };
}
