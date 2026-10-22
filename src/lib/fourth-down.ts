/**
 * Interface for the 4th down model: the 4th down decision and the try after a
 * touchdown. The contract is docs/model-interface.md.
 *
 * STUB: the model itself is Tyler's. This file only defines the shape the
 * site expects, so the calculator page can be built against it. Do not
 * implement decision logic here.
 *
 * Every probability is 0 to 1; format as a percent only when displaying.
 */

/** Version of docs/model-interface.md these types match */
export const CONTRACT_VERSION = 3;

export type FourthDownCall = 'go' | 'punt' | 'field goal';

/** nflfastR's `roof` values */
export type Roof = 'outdoors' | 'dome' | 'closed' | 'open';

export interface FourthDownSituation {
  season: number;
  /** Offense, site team abbreviation (LAR, not LA) */
  posteam: string;
  /** Defense, site team abbreviation */
  defteam: string;
  /** Home team abbreviation; the nominal home team at a neutral site (nflverse) */
  home: string;
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
  /** The home team received the opening kickoff */
  homeOpeningKickoff: boolean;
  roof: Roof;
  /** Degrees Fahrenheit, null when unknown; not read under a dome or closed roof */
  temp: number | null;
  /** ESPN athlete id. Missing means a league-average kicker. */
  kickerId?: string;
  /** Pregame spread in points, positive when the home team is favored (nflverse spread_line); null when unknown */
  spreadLine: number | null;
  /** Pregame total (over/under) in points; null when unknown */
  totalLine: number | null;
}

/** wpGo = conversionProb * wpIfConvert + (1 - conversionProb) * wpIfFail */
export interface GoOutcomes {
  /** Same value as the recommendation's conversionProb */
  conversionProb: number;
  wpIfConvert: number;
  wpIfFail: number;
}

/** wpFieldGoal = makeProb * wpIfMake + (1 - makeProb) * wpIfMiss */
export interface FieldGoalOutcomes {
  /** Same value as the recommendation's fgMakeProb */
  makeProb: number;
  wpIfMake: number;
  wpIfMiss: number;
}

/** wpPunt = wpAfterPunt, already averaged over where the punt lands */
export interface PuntOutcomes {
  wpAfterPunt: number;
}

/**
 * One option's win probability split into terms:
 * the sum of every wpDelta + residual = the option's WP - wpAllTermsOff.
 */
export interface TermBreakdown {
  /** The option's WP with every term turned off */
  wpAllTermsOff: number;
  /** Each term's contribution, in the order the page lists them; labels shown as is */
  terms: { term: string; wpDelta: number }[];
  /** What the terms do not explain */
  residual: number;
}

export interface FourthDownBreakdown {
  go: { outcomes: GoOutcomes; terms: TermBreakdown };
  /** Null when wpPunt is */
  punt: { outcomes: PuntOutcomes; terms: TermBreakdown } | null;
  /** Null when wpFieldGoal is */
  fieldGoal: { outcomes: FieldGoalOutcomes; terms: TermBreakdown } | null;
}

/** Always present; false when nothing was assumed. The page says so for each one set. */
export interface FourthDownFlags {
  /** temp was null in a game where it is read (roof outdoors or open) */
  temperatureUnknown: boolean;
  /** No kickerId given, or the model does not know it: a league-average kicker */
  kickerUnknown: boolean;
  /**
   * spreadLine or totalLine was null. Only the missing line is replaced: a
   * pick'em spread (0), or the median total_line of the last completed season.
   */
  linesUnknown: boolean;
}

export interface FourthDownRecommendation {
  /** The option with the highest win probability */
  call: FourthDownCall;
  /** Win probability if the offense goes for it */
  wpGo: number;
  /** Null when a punt is not a realistic option */
  wpPunt: number | null;
  /**
   * Null when kickDistance is over maxFieldGoalDistance, 70 yards to start,
   * set in the exported model JSON
   */
  wpFieldGoal: number | null;
  /** Chance of gaining the first down if the offense goes */
  conversionProb: number;
  /** Chance the field goal is good; null when wpFieldGoal is */
  fgMakeProb: number | null;
  /**
   * Field goal distance in yards, computed by the model from yardline100 and
   * the offset in its JSON. Always present; the site shows this and never
   * computes its own.
   */
  kickDistance: number;
  /** ESPN athlete id of the kicker the numbers used; null for a league-average kicker */
  kickerId: string | null;
  flags: FourthDownFlags;
  breakdown: FourthDownBreakdown;
}

/**
 * Never thrown, always returned. Unsupported carries no WP values:
 * 'overtime' is not supported in v1, 'endgame' is 15 seconds or less left in
 * the game, 'unavailable' when the model cannot be loaded or run (not in the
 * site yet, its JSON missing or failing to load, or evaluation failing).
 * reason can grow if other cases are ruled out.
 */
export type FourthDownResult =
  | ({ supported: true } & FourthDownRecommendation)
  | { supported: false; reason: 'overtime' | 'unavailable' | 'endgame' };

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
 * browser). Unavailable for every situation until the real implementation
 * lands.
 */
export function recommend(_situation: FourthDownSituation): FourthDownResult {
  return { supported: false, reason: 'unavailable' };
}

export type TryCall = 'kick' | 'go for 2';

/** The game state right after the touchdown, before the try */
export interface TrySituation {
  season: number;
  /** The team that scored and is attempting the try, site team abbreviation */
  posteam: string;
  /** Site team abbreviation */
  defteam: string;
  /** As in FourthDownSituation */
  home: string;
  /** Any overtime period. Returns not supported. */
  overtime: boolean;
  /** Seconds remaining in regulation */
  secondsRemaining: number;
  /** Seconds remaining in the half */
  halfSecondsRemaining: number;
  /**
   * Try team score minus opponent score after the touchdown, before the try
   * (nflverse score_differential on the try play): down 14, a touchdown makes it -8
   */
  scoreDiff: number;
  /** Timeouts remaining, try team */
  timeoutsOffense: number;
  /** Timeouts remaining, defense */
  timeoutsDefense: number;
  /** The home team received the opening kickoff */
  homeOpeningKickoff: boolean;
  roof: Roof;
  /** As in FourthDownSituation */
  spreadLine: number | null;
  /** As in FourthDownSituation */
  totalLine: number | null;
}

/** wp = successProb * wpIfSuccess + (1 - successProb) * wpIfFail */
export interface TryOutcomes {
  /** patMakeProb for the kick, twoPointConvProb for going for 2 */
  successProb: number;
  /** WP after the try succeeds: +1 for the kick, +2 for going for 2 */
  wpIfSuccess: number;
  /** WP after the try fails (+0); the same value in both options */
  wpIfFail: number;
}

/** The baseline has no correction terms for the try: terms empty, residual 0 */
export interface TryBreakdown {
  kick: { outcomes: TryOutcomes; terms: TermBreakdown };
  goForTwo: { outcomes: TryOutcomes; terms: TermBreakdown };
}

export interface TryRecommendation {
  /** The option with the higher win probability; an exact tie is 'go for 2' (nfl4th) */
  call: TryCall;
  /** Win probability if the try team kicks the extra point */
  wpKick: number;
  /** Win probability if the try team goes for 2 */
  wpGoForTwo: number;
  /** Chance the extra point is good */
  patMakeProb: number;
  /** Chance the 2-point conversion succeeds */
  twoPointConvProb: number;
  /** As in FourthDownFlags */
  flags: { linesUnknown: boolean };
  breakdown: TryBreakdown;
}

/** Never thrown, always returned. The reasons mean the same as in FourthDownResult. */
export type TryResult =
  | ({ supported: true } & TryRecommendation)
  | { supported: false; reason: 'overtime' | 'unavailable' | 'endgame' };

/**
 * STUB: replaced by Tyler's exported model, like recommend(). Unavailable for
 * every situation until the real implementation lands.
 */
export function recommendTry(_situation: TrySituation): TryResult {
  return { supported: false, reason: 'unavailable' };
}
