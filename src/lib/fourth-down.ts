/**
 * Interface for the 4th down model.
 *
 * STUB: the model itself is Tyler's. This file only defines the shape the
 * site expects, so the calculator page can be built against it. Do not
 * implement decision logic here.
 */

export interface FourthDownSituation {
  /** Yards from own goal line, 0 to 100 */
  ballOn: number;
  /** Yards to gain for a first down */
  distance: number;
  /** Seconds remaining in the game */
  secondsRemaining: number;
  /** Offense score minus defense score */
  scoreDiff: number;
  /** Timeouts remaining, offense */
  timeoutsOffense: number;
  /** Timeouts remaining, defense */
  timeoutsDefense: number;
}

export interface FourthDownRecommendation {
  call: 'go' | 'punt' | 'field goal';
  /** Win probability if the offense goes for it */
  wpGo: number;
  /** Win probability for the best kicking option */
  wpKick: number;
}

/**
 * STUB: replaced by Tyler's exported model (see models/). Throws until
 * the real implementation lands.
 */
export function recommend(_situation: FourthDownSituation): FourthDownRecommendation {
  throw new Error('4th down model not implemented yet');
}
