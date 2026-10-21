/**
 * Interface for the 4th down model. The contract is docs/model-interface.md.
 *
 * STUB: the model itself is Tyler's. This file only defines the shape the
 * site expects, so the calculator page can be built against it. Do not
 * implement decision logic here.
 *
 * Every probability is 0 to 1; format as a percent only when displaying.
 */

export type FourthDownCall = 'go' | 'punt' | 'field goal';

/** nflfastR's `roof` values */
export type Roof = 'outdoors' | 'dome' | 'closed' | 'open';

export interface FourthDownSituation {
  season: number;
  /** Offense, site team abbreviation (LAR, not LA) */
  posteam: string;
  /** Defense, site team abbreviation */
  defteam: string;
  /** Home team abbreviation, null at a neutral site */
  home: string | null;
  /**
   * Yards to the opponent's goal line, 1 to 99 (nflfastR's yardline_100).
   * Convert at the boundary: ESPN's situation in the live page's parser,
   * the form's inputs on the calculator.
   */
  yardline100: number;
  /** Yards to gain for a first down */
  distance: number;
  /** Any overtime period. v1 returns not supported. */
  overtime: boolean;
  /** Seconds remaining in regulation; not read in overtime */
  secondsRemaining: number;
  /** Seconds remaining in the half; not read in overtime */
  halfSecondsRemaining: number;
  /** Offense score minus defense score */
  scoreDiff: number;
  /** Timeouts remaining, offense */
  timeoutsOffense: number;
  /** Timeouts remaining, defense */
  timeoutsDefense: number;
  /** The offense receives the second half kickoff (first half only) */
  receives2ndHalfKickoff: boolean;
  roof: Roof;
  /** Degrees Fahrenheit, null when unknown; not read under a dome or closed roof */
  temp: number | null;
  /** ESPN athlete id. Missing means a league-average kicker. */
  kickerId?: string;
}

/**
 * One option's win probability split into terms:
 * base + the sum of every wpDelta + residual equals the option's WP exactly.
 */
export interface OptionBreakdown {
  /** WP the terms start from */
  base: number;
  /** Each term's contribution, in the order the page lists them; labels shown as is */
  terms: { term: string; wpDelta: number }[];
  /** What the terms do not explain, so the total matches */
  residual: number;
}

export interface FourthDownBreakdown {
  go: OptionBreakdown;
  /** Null when wpPunt is */
  punt: OptionBreakdown | null;
  /** Null when wpFieldGoal is */
  fieldGoal: OptionBreakdown | null;
}

export interface FourthDownRecommendation {
  /** The option with the highest win probability */
  call: FourthDownCall;
  /** Win probability if the offense goes for it */
  wpGo: number;
  /** Null when a punt is not a realistic option */
  wpPunt: number | null;
  /**
   * Null when the kick (yardline100 + 17) is over maxFieldGoalDistance,
   * 70 yards to start, set in the exported model JSON
   */
  wpFieldGoal: number | null;
  /** Chance of gaining the first down if the offense goes */
  conversionProb: number;
  /** Chance the field goal is good; null when wpFieldGoal is */
  fgMakeProb: number | null;
  /**
   * The kicker the numbers used. leagueAverage is true, and id null, when no
   * kickerId was given or the model does not know it; the page must say so.
   */
  kicker: { id: string | null; leagueAverage: boolean };
  /** The model may set this when temp was null and it mattered; the page says so */
  tempUnknown?: boolean;
  breakdown: FourthDownBreakdown;
}

/** Overtime is not supported in v1; reason can grow if other cases are ruled out. */
export type FourthDownResult =
  | ({ supported: true } & FourthDownRecommendation)
  | { supported: false; reason: 'overtime' };

/**
 * One graded call in model_record.json: the coach's choice differed from the
 * model's and gave up at least the file's threshold in win probability.
 */
export interface GradedCall {
  /** nflverse game_id, e.g. "2026_07_BUF_KC" */
  gameId: string;
  /** nflverse play_id */
  playId: number;
  week: number;
  /** Play description as nflverse publishes it */
  description: string;
  situation: FourthDownSituation;
  coachCall: FourthDownCall;
  modelCall: FourthDownCall;
  wpGo: number;
  wpPunt: number | null;
  wpFieldGoal: number | null;
  /** WP of the model's call minus WP of the coach's, at the moment of decision */
  wpCost: number;
}

/** Season-level calibration of the model's win probabilities against results */
export interface CalibrationSummary {
  plays: number;
  /** Mean squared error of predicted WP against the result, lower is better */
  brier: number;
  bins: { lo: number; hi: number; predicted: number; observed: number; plays: number }[];
}

/**
 * model_record.json, restored when the model exists. Season totals are
 * derived from calls, never stored. Move into src/data/types.ts with the file.
 */
export interface ModelRecordData {
  season: number;
  /** ISO timestamp of the last pipeline run */
  updated: string;
  /** Minimum WP gap for a play to be graded; starts at 0.02 */
  threshold: number;
  calls: GradedCall[];
  /** Null until there are enough plays */
  calibration: CalibrationSummary | null;
}

/**
 * STUB: replaced by Tyler's exported model (JSON in models/, run in the
 * browser). Throws until the real implementation lands.
 */
export function recommend(_situation: FourthDownSituation): FourthDownResult {
  throw new Error('4th down model not implemented yet');
}
