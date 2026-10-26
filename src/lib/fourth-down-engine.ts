/**
 * GENERATED FROM fourth-down (js/engine.ts). DO NOT EDIT in tylernfl: the
 * model-delivery PR overwrites this file. Change it in fourth-down, where it
 * is tested against the Python model.
 *
 * Browser engine for the 4th down model: recommend() and recommendTry() from
 * docs/model-interface.md (contract version 5), evaluated from the exported
 * model JSON (scripts/export_model.py).
 *
 * Contract v5 adds the experimental model next to nfl4th (recommend()'s
 * `experimental`): nfl4th plus four correction terms, ported from
 * src/decisions/fourth_down/experimental.py (recommend_experimental_many).
 * It reads its own files (sneak.json, punter.json, coverage.json,
 * teamPunters.json and terms.json's `experimental`); if they are missing or
 * fail to load, `experimental` is 'unavailable' and nfl4th's result is
 * unchanged.
 *
 * The model is the decision baseline, nfl4th at commit ecb7293. This file
 * ports the same code the Python port does (src/core/nfl4th/,
 * src/decisions/*), quirks included; each function names its Python twin.
 * The fixtures from scripts/export_model.py check it: every probability
 * within 1e-6 of Python, and calls, null options, flags and reasons exact.
 *
 * Loading is the page's job and may be async (fetch the JSON, then call
 * loadModel()); recommend() and recommendTry() are synchronous and return
 * { supported: false, reason: 'unavailable' } until a model is loaded.
 * Nothing here throws to the caller.
 */

/** Contract version this engine implements */
export const ENGINE_CONTRACT_VERSION = 5;

// ---------------------------------------------------------------------------
// Contract types (structurally identical to src/lib/fourth-down.ts)

type Roof = 'outdoors' | 'dome' | 'closed' | 'open';
type Unsupported = { supported: false; reason: 'overtime' | 'unavailable' | 'endgame' };

export interface EngineFourthDownSituation {
  season: number;
  posteam: string;
  defteam: string;
  home: string;
  yardline100: number;
  distance: number;
  overtime: boolean;
  secondsRemaining: number;
  halfSecondsRemaining: number;
  scoreDiff: number;
  timeoutsOffense: number;
  timeoutsDefense: number;
  homeOpeningKickoff: boolean;
  roof: Roof;
  temp: number | null;
  kickerId?: string;
  /** ESPN athlete id of the punter; only the experimental model reads it */
  punterId?: string;
  spreadLine: number | null;
  totalLine: number | null;
}

export interface EngineTrySituation {
  season: number;
  posteam: string;
  defteam: string;
  home: string;
  overtime: boolean;
  secondsRemaining: number;
  halfSecondsRemaining: number;
  scoreDiff: number;
  timeoutsOffense: number;
  timeoutsDefense: number;
  homeOpeningKickoff: boolean;
  roof: Roof;
  spreadLine: number | null;
  totalLine: number | null;
}

interface TermBreakdown {
  wpAllTermsOff: number;
  terms: { term: string; wpDelta: number }[];
  residual: number;
}

export type EngineFourthDownResult =
  | {
      supported: true;
      call: 'go' | 'punt' | 'field goal';
      wpGo: number;
      wpPunt: number | null;
      wpFieldGoal: number | null;
      conversionProb: number;
      fgMakeProb: number | null;
      kickDistance: number;
      kickerId: string | null;
      flags: { temperatureUnknown: boolean; kickerUnknown: boolean; linesUnknown: boolean };
      breakdown: {
        go: {
          /** wpIfConvert is null when no gain reaches the line to gain (4th and more than 65) */
          outcomes: { conversionProb: number; wpIfConvert: number | null; wpIfFail: number };
          terms: TermBreakdown;
        };
        punt: { outcomes: { wpAfterPunt: number }; terms: TermBreakdown } | null;
        fieldGoal: { outcomes: { makeProb: number; wpIfMake: number; wpIfMiss: number }; terms: TermBreakdown } | null;
      };
      experimental: ExperimentalResult;
    }
  | Unsupported;

type OptionKey = 'go' | 'punt' | 'fieldGoal';

interface ChangedInput {
  id: string;
  label: string;
  unit: 'probability' | 'yards';
  nfl4th: number;
  experimental: number;
}

interface ExperimentalOption<O> {
  wp: number;
  wpAllTermsOff: number;
  outcomes: O;
  changedInputs: ChangedInput[];
  residual: number;
}

interface ExperimentalTerm {
  id: string;
  label: string;
  options: OptionKey[];
  applies: boolean;
  notApplicableText: string | null;
  wpDelta: Partial<Record<OptionKey, number>>;
}

export type ExperimentalResult =
  | {
      supported: true;
      modelId: string;
      label: string;
      dataAsOf: { season: number; week: number };
      call: 'go' | 'punt' | 'field goal';
      wpGo: number;
      wpPunt: number | null;
      wpFieldGoal: number | null;
      options: {
        go: ExperimentalOption<{ conversionProb: number; wpIfConvert: number | null; wpIfFail: number }>;
        punt: ExperimentalOption<{ wpAfterPunt: number }> | null;
        fieldGoal: ExperimentalOption<{ makeProb: number; wpIfMake: number; wpIfMiss: number }> | null;
      };
      terms: ExperimentalTerm[];
      flags: { punterUnknown: boolean; punterNoHistory: boolean; coverageNoHistory: boolean };
    }
  | { supported: false; reason: 'unavailable' | 'season' };

interface TryOutcomes {
  successProb: number;
  wpIfSuccess: number;
  wpIfFail: number;
}

export type EngineTryResult =
  | {
      supported: true;
      call: 'kick' | 'go for 2';
      wpKick: number;
      wpGoForTwo: number;
      patMakeProb: number;
      twoPointConvProb: number;
      flags: { linesUnknown: boolean };
      breakdown: {
        kick: { outcomes: TryOutcomes; terms: TermBreakdown };
        goForTwo: { outcomes: TryOutcomes; terms: TermBreakdown };
      };
    }
  | Unsupported;

// ---------------------------------------------------------------------------
// Exported model files

interface BoosterJson {
  modelVersion: string;
  objective: 'binary:logistic' | 'multi:softprob';
  numClass: number;
  numFeature: number;
  baseMargin: number;
  treeSizes: number[];
  treeClass: number[];
  feature: number[];
  right: number[];
  defaultLeft: number[];
  value: number[];
}

/** The JSON files scripts/export_model.py writes to models/, parsed. */
export interface ModelFiles {
  manifest: {
    contractVersion: number;
    modelVersion: string;
    kickDistanceOffset: number;
    maxFieldGoalDistance: number;
    fallbackTotalLine: { value: number; season: number };
    teams: { nflverseToSite: Record<string, string> };
  };
  fdModel: BoosterJson;
  epModel: BoosterJson;
  homeWpModel: BoosterJson;
  wpSpreadModel: BoosterJson;
  twoPtModel: BoosterJson;
  tables: {
    modelVersion: string;
    fgMakeProb: Record<string, number[]>;
    punt: { yardline100: number[]; yardlineAfter: number[]; pct: number[]; muff: number[] };
  };
  terms: {
    modelVersion: string;
    fourthDown: unknown[];
    try: unknown[];
    kickers: Record<string, unknown>;
    /** The experimental model (contract v5) */
    experimental: {
      modelId: string;
      label: string;
      season: number;
      dataAsOf: { season: number; week: number };
      terms: string[];
    };
  };
  sneak: ExperimentalTable<{ usage: number; leagueUsage: number; beta: number; offset: number }> & { forWeek: number };
  punter: {
    modelVersion: string;
    season: number;
    zones: Zone[];
    punters: Record<string, { name: string | null; effect: number }>;
  };
  coverage: ExperimentalTable<{ franchise: number; teamSeason: number; effect: number; noHistory: boolean }> & { zones: Zone[] };
  teamPunters: ExperimentalTable<{ punterId: string | null; name: string | null }>;
}

interface Zone {
  name: string;
  yardline100Min: number;
  yardline100Max: number;
  multiplier: number;
}

interface ExperimentalTable<T> {
  modelVersion: string;
  season: number;
  dataAsOf: { season: number; week: number };
  teams: Record<string, T>;
}

// ---------------------------------------------------------------------------
// XGBoost tree evaluation (src/core/export/trees.py predict)

interface Booster {
  binary: boolean;
  numClass: number;
  numFeature: number;
  baseMargin: number;
  treeStart: Int32Array;
  treeClass: Int32Array;
  feature: Int32Array;
  right: Int32Array;
  defaultLeft: Uint8Array;
  value: Float32Array;
}

function toBooster(j: BoosterJson): Booster {
  const n = j.feature.length;
  if (j.right.length !== n || j.defaultLeft.length !== n || j.value.length !== n) throw new Error('booster arrays');
  if (j.treeSizes.length !== j.treeClass.length) throw new Error('booster trees');
  const treeStart = new Int32Array(j.treeSizes.length);
  let start = 0;
  for (let t = 0; t < j.treeSizes.length; t++) {
    treeStart[t] = start;
    start += j.treeSizes[t];
  }
  if (start !== n) throw new Error('booster tree sizes');
  return {
    binary: j.objective === 'binary:logistic',
    numClass: j.numClass,
    numFeature: j.numFeature,
    baseMargin: j.baseMargin,
    treeStart,
    treeClass: Int32Array.from(j.treeClass),
    feature: Int32Array.from(j.feature),
    right: Int32Array.from(j.right),
    defaultLeft: Uint8Array.from(j.defaultLeft),
    // Every value is a float32 written in its shortest form, so this is exact.
    value: Float32Array.from(j.value),
  };
}

const f32 = Math.fround;

/**
 * XGBoost's prediction, reproduced: float32 inputs, float32 margin
 * accumulation in tree order (bit-exact), then the link. JavaScript has no
 * float32 exp, so the link can differ from XGBoost by 1 float32 ulp (3e-8).
 */
function predict(b: Booster, x: number[]): number[] {
  const xs = Float32Array.from(x);
  const margin = new Float32Array(b.numClass).fill(b.baseMargin);
  const { feature, right, defaultLeft, value, treeStart, treeClass } = b;
  for (let t = 0; t < treeStart.length; t++) {
    const start = treeStart[t];
    let i = start;
    while (feature[i] >= 0) {
      const v = xs[feature[i]];
      // NaN takes the default direction; otherwise left when x < threshold.
      const left = v !== v ? defaultLeft[i] === 1 : v < value[i];
      i = left ? i + 1 : start + right[i];
    }
    // Storing into a Float32Array rounds the sum to float32, as XGBoost does.
    margin[treeClass[t]] = margin[treeClass[t]] + value[i];
  }
  if (b.binary) return [f32(1 / f32(1 + f32(Math.exp(-margin[0]))))];
  let mx = -Infinity;
  for (let k = 0; k < margin.length; k++) mx = Math.max(mx, margin[k]);
  const e = new Float32Array(margin.length);
  let s = 0; // XGBoost sums the exps in double
  for (let k = 0; k < margin.length; k++) {
    e[k] = Math.exp(f32(margin[k] - mx));
    s += e[k];
  }
  const sf = f32(s);
  return Array.from(e, (v) => f32(v / sf));
}

// ---------------------------------------------------------------------------
// Game state (src/core/nfl4th/prepare.py, game_state.py)

/** One game state, as a row of the port's prepared play frame. */
interface State {
  season: number;
  homeTeam: string;
  awayTeam: string;
  posteam: string;
  /** The team facing the decision; every WP is from its view. */
  originalPosteam: string;
  qtr: number;
  halfSeconds: number;
  gameSeconds: number;
  down: number;
  ydstogo: number;
  yardline100: number;
  scoreDiff: number;
  homeOpeningKickoff: number;
  /** nfl4th's -1/0/1 quirk column, home team's view */
  homeReceive2hKo: number;
  homeTimeouts: number;
  awayTimeouts: number;
  /** The 4th down's posteam/defteam timeouts: never swapped (quirk) */
  posteamTimeouts: number;
  defteamTimeouts: number;
  spreadLine: number;
  totalLine: number;
  posteamSpread: number;
  posteamTotal: number;
  /** Stale: computed once from the 4th down's clock (quirk) */
  elapsedShare: number;
  spreadTime: number;
  era3: number;
  era4: number;
  modelRoof: 'retractable' | 'dome' | 'outdoors';
  fgModelRoof: string;
}

interface Model {
  version: string;
  kickDistanceOffset: number;
  maxFieldGoalDistance: number;
  fallbackTotal: number;
  fd: Booster;
  ep: Booster;
  homeWp: Booster;
  wpSpread: Booster;
  twoPt: Booster;
  fgMakeProb: Record<string, number[]>;
  /** yardline100 -> that yardline's punt outcome rows, in table order */
  punt: Map<number, PuntRow[]>;
  /** The experimental model, or null when its files are missing or broken */
  experimental: Experimental | null;
}

interface PuntRow {
  after: number;
  pct: number;
  muff: number;
}

interface Experimental {
  modelId: string;
  label: string;
  season: number;
  dataAsOf: { season: number; week: number };
  sneak: ModelFiles['sneak']['teams'];
  punterZones: Zone[];
  punters: ModelFiles['punter']['punters'];
  coverageZones: Zone[];
  coverage: ModelFiles['coverage']['teams'];
  teamPunters: ModelFiles['teamPunters']['teams'];
}

/** kickoff_yardline: own 30 from 2024 (new kickoff rules), own 25 before. */
const kickoffYardline = (season: number) => (season >= 2024 ? 70 : 75);

/** flip_team: change of possession, 1st and 10, 6 s off. */
function flipTeam(d: State): State {
  return {
    ...d,
    posteam: d.homeTeam === d.posteam ? d.awayTeam : d.homeTeam,
    scoreDiff: -d.scoreDiff,
    down: 1,
    ydstogo: 10,
    halfSeconds: Math.max(d.halfSeconds - 6, 0),
    gameSeconds: Math.max(d.gameSeconds - 6, 0),
  };
}

/** flip_half: if the play ended the first half, jump to the 2nd half kickoff. */
function flipHalf(d: State): State {
  if (!(d.qtr === 2 && d.halfSeconds === 0)) return d;
  const posteam = d.homeOpeningKickoff === 1 ? d.awayTeam : d.homeTeam;
  return {
    ...d,
    posteam,
    qtr: 3,
    down: 1,
    ydstogo: 10,
    yardline100: kickoffYardline(d.season),
    halfSeconds: 1800,
    gameSeconds: 1800,
    scoreDiff: posteam !== d.posteam ? -d.scoreDiff : d.scoreDiff,
    homeReceive2hKo: 0,
  };
}

/** The defense's timeouts in nfl4th's end_game_fn (home/away columns). */
const defTimeouts = (d: State) => (d.posteam === d.homeTeam ? d.awayTimeouts : d.homeTimeouts);

/** _kneel_out: the team ahead can kneel out the clock. */
function kneelOut(score: number, gsr: number, defTo: number): boolean {
  return score > 0 && ((gsr < 120 && defTo === 0) || (gsr < 80 && defTo === 1) || (gsr < 40 && defTo === 2));
}

/** end_game_fn: the other team has the ball and can kneel -> WP 0. */
const endGame = (d: State, wp: number) => (kneelOut(d.scoreDiff, d.gameSeconds, defTimeouts(d)) ? 0 : wp);

/** _fg_prob_at: nfl4th's FG GAM at an integer yardline_100. */
function fgProbAt(m: Model, d: State, yardline: number): number {
  const p = m.fgMakeProb[d.fgModelRoof]?.[yardline - 1];
  return p === undefined ? NaN : p;
}

// ---------------------------------------------------------------------------
// Win probability (src/core/nfl4th/win_prob.py)

/** expected_points: nflfastR EP for the current posteam. */
function expectedPoints(m: Model, d: State): number {
  const s = d.season;
  const x = [
    d.halfSeconds,
    d.yardline100,
    +(d.posteam === d.homeTeam),
    +(d.modelRoof === 'retractable'),
    +(d.modelRoof === 'dome'),
    +(d.modelRoof === 'outdoors'),
    d.ydstogo,
    +(s <= 2001),
    +(s > 2001 && s <= 2005),
    +(s > 2005 && s <= 2013),
    +(s > 2013 && s <= 2017),
    +(s > 2017),
    +(d.down === 1),
    +(d.down === 2),
    +(d.down === 3),
    +(d.down === 4),
    d.posteamTimeouts,
    d.defteamTimeouts,
  ];
  // Classes: td, opp_td, fg, opp_fg, safety, opp_safety, no_score. Summed in
  // nflfastR's order.
  const [td, oppTd, fg, oppFg, saf, oppSaf] = predict(m.ep, x);
  return -3 * oppFg + -2 * oppSaf + -7 * oppTd + 3 * fg + 2 * saf + 7 * td;
}

/** calculate_win_probability: average of nfl4th's home WP model and
 * nflfastR's spread WP model, from the decision team's view. */
function winProbability(m: Model, d: State): number {
  const homeHasBall = d.posteam === d.homeTeam;
  const score = d.scoreDiff;

  const ep = expectedPoints(m, d);
  const homeScore = homeHasBall ? score : -score;
  let homeWp = predict(m.homeWp, [
    d.homeReceive2hKo,
    d.spreadTime,
    +homeHasBall,
    d.halfSeconds,
    d.gameSeconds,
    homeScore / Math.exp(-4 * d.elapsedShare),
    homeScore,
    homeHasBall ? ep : -ep,
    d.ydstogo,
    homeHasBall ? d.yardline100 : 100 - d.yardline100,
    d.homeTimeouts,
  ])[0];

  const firstHalf = d.qtr <= 2;
  const awayHasBall = d.posteam === d.awayTeam;
  const receive2hKo =
    (firstHalf && d.homeOpeningKickoff === 1 && awayHasBall) || (firstHalf && d.homeOpeningKickoff === 0 && homeHasBall) ? 1 : 0;
  const posTo = awayHasBall ? d.awayTimeouts : d.homeTimeouts;
  const defTo = homeHasBall ? d.awayTimeouts : d.homeTimeouts;
  const gsr = d.gameSeconds;
  const decay = Math.exp(-4 * ((3600 - gsr) / 3600));
  const posteamSpread = homeHasBall ? d.spreadLine : -d.spreadLine;
  let posWp = predict(m.wpSpread, [
    receive2hKo,
    posteamSpread * decay,
    +homeHasBall,
    d.halfSeconds,
    gsr,
    score / decay,
    score,
    d.down,
    d.ydstogo,
    d.yardline100,
    posTo,
    defTo,
  ])[0];

  if (d.originalPosteam === d.awayTeam) homeWp = 1 - homeWp;
  if (d.posteam !== d.originalPosteam) posWp = 1 - posWp;
  return (homeWp + posWp) / 2;
}

// ---------------------------------------------------------------------------
// After a touchdown (src/core/nfl4th/try_wp.py get_2pt_wp)

interface TryWp {
  wp0: number;
  wp1: number;
  wp2: number;
  conv1: number;
  conv2: number;
  go1: number;
  go2: number;
  wpTd: number;
}

function tryWp(m: Model, td: State): TryWp {
  const conv2 = predict(m.twoPt, [
    0, // era2 forced to 0
    td.era3,
    td.era4,
    +(td.modelRoof === 'outdoors'),
    +(td.modelRoof === 'retractable'),
    +(td.modelRoof === 'dome'),
    td.posteamSpread,
    td.totalLine,
    td.posteamTotal,
  ])[0];
  // PAT: the FG model at yardline_100 15 (a 33-yard kick) in every season.
  const conv1 = fgProbAt(m, td, 15);
  const wps = [0, 1, 2].map((pts) => {
    // The opponent receives the kickoff after the try, clock unchanged.
    const s = flipHalf({
      ...td,
      scoreDiff: -td.scoreDiff - pts,
      posteam: td.homeTeam === td.posteam ? td.awayTeam : td.homeTeam,
      yardline100: kickoffYardline(td.season),
      down: 1,
      ydstogo: 10,
    });
    return winProbability(m, s);
  });
  const [wp0, wp1, wp2] = wps;
  const go2 = conv2 * wp2 + (1 - conv2) * wp0;
  const go1 = conv1 * wp1 + (1 - conv1) * wp0;
  // An exact tie takes go for 2; NaN propagates.
  const wpTd = Number.isNaN(go1) || Number.isNaN(go2) ? NaN : go1 > go2 ? go1 : go2;
  return { wp0, wp1, wp2, conv1, conv2, go1, go2, wpTd };
}

// ---------------------------------------------------------------------------
// 4th down options (src/decisions/fourth_down/nfl4th.py)

/** GAINS: the fd_model's 76 classes are yards gained -10..65. */
const GAIN_MIN = -10;
const N_GAINS = 76;

interface GoWp {
  pConvert: number;
  wpConvert: number;
  wpFail: number;
  /** fd_model's 76 class probabilities (down = 4), for the experimental model */
  probs: number[];
}

/** get_go_wp */
function goWp(m: Model, d: State): GoWp {
  const probs = predict(m.fd, [
    d.down,
    d.ydstogo,
    d.yardline100,
    d.era3,
    d.era4,
    +(d.modelRoof === 'outdoors'),
    +(d.modelRoof === 'retractable'),
    +(d.modelRoof === 'dome'),
    d.posteamSpread,
    d.totalLine,
    d.posteamTotal,
  ]);
  // Gains past the goal line become a TD at exactly yardline_100; their
  // probabilities are pooled. One branch per distinct gain, ascending.
  const y0 = d.yardline100;
  const pooled = new Map<number, number>();
  for (let k = 0; k < N_GAINS; k++) {
    const g = Math.min(GAIN_MIN + k, y0);
    pooled.set(g, (pooled.get(g) ?? 0) + probs[k]);
  }
  // 6 s per play (no extra runoff), and every branch shares the clock
  // floored at 0 (the grouped max quirk is an elementwise floor here).
  const hsr = Math.max(d.halfSeconds - 6, 0);
  const gsr = Math.max(d.gameSeconds - 6, 0);

  let pctS = 0, pctF = 0, hasS = false;
  const branches: { prob: number; turnover: boolean; wp: number }[] = [];
  for (const [gain, prob] of [...pooled.entries()].sort((a, b) => a[0] - b[0])) {
    const turnover = gain < d.ydstogo;
    const yl = y0 - gain;
    // Turnover on downs: the opponent's ball at the spot, score flipped. No
    // special case for safeties (quirk, kept).
    const yardline100 = turnover ? 100 - yl : yl;
    let score = turnover ? -d.scoreDiff : d.scoreDiff;
    const td = yardline100 === 0;
    if (td) score += 6;
    let s: State = {
      ...d,
      down: 1,
      yardline100,
      posteam: turnover ? (d.posteam === d.homeTeam ? d.awayTeam : d.homeTeam) : d.posteam,
      scoreDiff: score,
      halfSeconds: hsr,
      gameSeconds: gsr,
      ydstogo: yardline100 < 10 ? yardline100 : 10,
    };
    // TD branches take the better of the PAT and going for 2, valued at the
    // state before flip_half, and used only if the field position is still
    // the goal line after it.
    const wpTd = td ? tryWp(m, s).wpTd : NaN;
    s = flipHalf(s);
    let wp = s.yardline100 === 0 ? wpTd : winProbability(m, s);
    const kneel = kneelOut(s.scoreDiff, s.gameSeconds, defTimeouts(s));
    // Converted and ahead with the clock nearly gone: WP 1. Failed and the
    // opponent ahead (posteam is now the opponent): WP 0.
    if (kneel && !turnover && s.yardline100 > 0) wp = 1;
    if (kneel && turnover) wp = 0;
    branches.push({ prob, turnover, wp });
    if (turnover) pctF += prob;
    else {
      pctS += prob;
      hasS = true;
    }
  }
  let wpS = 0, wpF = 0;
  for (const b of branches) {
    if (b.turnover) wpF += (b.prob / pctF) * b.wp;
    else wpS += (b.prob / pctS) * b.wp;
  }
  // No gain reaches the line to gain: no convert branch (nfl4th's NaN), so
  // the conversion probability is 0 (model.branch_inputs_from_nfl4th).
  return hasS ? { pConvert: pctS, wpConvert: wpS, wpFail: wpF, probs } : { pConvert: 0, wpConvert: NaN, wpFail: wpF, probs };
}

/** get_fg_wp */
function fgWp(m: Model, d: State): { pMake: number; wpMake: number; wpMiss: number } {
  const y = d.yardline100;
  const pRaw = fgProbAt(m, d, y);
  // Kicks longer than 58 yards (yardline_100 > 40): the 58-yard make
  // probability scaled linearly to 0 at 71 yards (nfl4th's hand-set decay).
  const p58 = fgProbAt(m, d, 40);
  let pMake = y > 40 ? ((53 - y) / 13) * p58 : pRaw;
  if (y >= 53) pMake = 0;

  // Make: the opponent receives a kickoff, down 3 more points.
  let mk = flipTeam(d);
  mk = flipHalf({ ...mk, yardline100: kickoffYardline(mk.season), scoreDiff: mk.scoreDiff - 3 });
  const wpMake = endGame(mk, winProbability(m, mk));

  // Miss: the opponent's ball at the spot (8 yards back), capped at its 20.
  let ms = flipTeam(d);
  let yl = 100 - ms.yardline100 - 8;
  if (yl > 80) yl = 80;
  ms = flipHalf({ ...ms, yardline100: yl < 1 ? 1 : yl });
  const wpMiss = endGame(ms, winProbability(m, ms));
  return { pMake, wpMake, wpMiss };
}

/**
 * get_punt_wp: NaN where nfl4th has no punt outcomes for the yardline.
 * `rows` replaces nfl4th's rows for this yardline (the experimental shift).
 */
function puntWp(m: Model, d: State, rows: PuntRow[] | undefined = m.punt.get(d.yardline100)): number {
  if (!rows) return NaN;
  let total = 0;
  for (const r of rows) {
    let p = flipTeam(d);
    const retTd = r.after === 100;
    const muffed = r.muff === 1;
    let yardline100 = 100 - r.after;
    // Return TD or muff: the punting team ends up with the ball.
    const posteam = retTd || muffed ? d.originalPosteam : p.posteam;
    if (muffed) yardline100 = 100 - yardline100;
    if (retTd) yardline100 = kickoffYardline(p.season);
    let score = p.scoreDiff;
    if (retTd) score = -score - 7;
    if (muffed) score = -score;
    p = flipHalf({ ...p, posteam, yardline100, scoreDiff: score, ydstogo: yardline100 < 10 ? yardline100 : p.ydstogo });
    total += r.pct * endGame(p, winProbability(m, p));
  }
  return total;
}


// ---------------------------------------------------------------------------
// Experimental model (src/decisions/fourth_down/experimental.py)

/** Term ids in display order (experimental.TERM_IDS). */
const TERM_IDS = ['conversionFix', 'qbSneak', 'punter', 'puntCoverage'];

/**
 * Every term on. scripts/check_engine_mutations.py switches one off at a
 * time in a scratch copy of this file and requires the fixtures to fail.
 */
const TERMS_ON = { conversionFix: true, qbSneak: true, punter: true, puntCoverage: true };

/**
 * fd_convert.fd_convert_prob: P(gain >= ydstogo) from fd_model's classes,
 * gains capped at the goal line. `probs` are the classes for the down asked.
 */
function fdConvertProb(probs: number[], d: State): number {
  let p = 0;
  for (let k = 0; k < N_GAINS; k++) if (Math.min(GAIN_MIN + k, d.yardline100) >= d.ydstogo) p += probs[k];
  return p;
}

/** fd_model's classes with `down` in place of the play's (penalty_removal: down = 3). */
function fdProbs(m: Model, d: State, down: number): number[] {
  return predict(m.fd, [
    down,
    d.ydstogo,
    d.yardline100,
    d.era3,
    d.era4,
    +(d.modelRoof === 'outdoors'),
    +(d.modelRoof === 'retractable'),
    +(d.modelRoof === 'dome'),
    d.posteamSpread,
    d.totalLine,
    d.posteamTotal,
  ]);
}

const logit = (p: number) => Math.log(p / (1 - p));
const expit = (x: number) => 1 / (1 + Math.exp(-x));

/** experimental.shift_convert (model B): a zero offset, or p of 0 or 1, keeps p. */
function shiftConvert(p: number, off: number): number {
  return off === 0 || p === 0 || p === 1 ? p : expit(logit(p) + off);
}

/** The zone's multiplier for a yardline (punts.ZONES); 0 outside every zone. */
function zoneValue(zones: Zone[], yl: number): number {
  for (const z of zones) if (yl >= z.yardline100Min && yl <= z.yardline100Max) return z.multiplier;
  return 0;
}

/**
 * punts.shift_table for one play (build choice C, entry 024): landing spots
 * and their muff copies move `shift` yards toward the receiving team's goal
 * line, a fractional shift splitting a row's mass between the two
 * neighbouring yardlines; mass at or past the goal line becomes a touchback
 * at the 20 (no muff); a negative shift stops at the 99. Blocks (the non-muff
 * row at the line of scrimmage), return TDs (100) and touchbacks (the 20)
 * stay put. Rows are not merged as in Python: WP is linear in the rows.
 */
function shiftRows(rows: PuntRow[], yl: number, shift: number): PuntRow[] {
  const out: PuntRow[] = [];
  for (const r of rows) {
    const block = r.muff === 0 && r.after === yl;
    if (shift === 0 || block || r.after === 100 || r.after === 20) {
      out.push(r);
      continue;
    }
    const target = r.after - shift;
    const lo = Math.floor(target);
    const wHi = target - lo;
    for (const [spot, w] of [[lo, 1 - wHi], [lo + 1, wHi]] as const) {
      const pct = r.pct * w;
      if (!(pct > 0)) continue;
      const pastGoal = spot <= 0;
      out.push({ after: pastGoal ? 20 : Math.min(spot, 99), pct, muff: pastGoal ? 0 : r.muff });
    }
  }
  return out;
}

/** The punt WP with nfl4th's rows shifted; a zero shift is nfl4th's own WP. */
function shiftedPuntWp(m: Model, d: State, base: number, shift: number): number {
  if (shift === 0) return base;
  return puntWp(m, d, shiftRows(m.punt.get(d.yardline100)!, d.yardline100, shift));
}

interface BaseFourthDown {
  wpGo: number;
  go: GoWp;
  hasPunt: boolean;
  punt: number;
  fgOk: boolean;
  wpKick: number;
  fg: { pMake: number; wpMake: number; wpMiss: number };
}

/** experimental._resolve_punter: a given punterId, else the team's latest punter (D4). */
function resolvePunter(x: Experimental, s: EngineFourthDownSituation) {
  let pid: string | null = typeof s.punterId === 'string' && s.punterId !== '' ? s.punterId : null;
  let fallbackName: string | null = null;
  if (pid === null) {
    const tp = Object.hasOwn(x.teamPunters, s.posteam) ? x.teamPunters[s.posteam] : undefined;
    if (!tp || !tp.punterId) return { name: null as string | null, u: null as number | null, unknown: true, noHistory: false };
    pid = tp.punterId;
    fallbackName = tp.name;
  }
  const row = Object.hasOwn(x.punters, pid) ? x.punters[pid] : undefined;
  if (!row) return { name: fallbackName, u: null, unknown: false, noHistory: true };
  return { name: row.name, u: row.effect, unknown: false, noHistory: false };
}

function term(id: string, label: string, option: OptionKey, applies: boolean, delta: number, naText: string): ExperimentalTerm {
  return { id, label, options: [option], applies, notApplicableText: applies ? null : naText, wpDelta: { [option]: applies ? delta : 0 } };
}

/** experimental.recommend_experimental_many, for one supported situation. */
function experimentalResult(m: Model, s: EngineFourthDownSituation, d: State, b: BaseFourthDown): ExperimentalResult {
  const x = m.experimental;
  if (!x) return { supported: false, reason: 'unavailable' };
  if (Math.trunc(s.season) !== x.season) return { supported: false, reason: 'season' };

  // Go: the conversion fix and the sneak offset, added in log-odds and
  // applied once to fd_model's P(convert) (down = 4), as model B does.
  const p4 = fdConvertProb(b.go.probs, d);
  const p3 = fdConvertProb(fdProbs(m, d, 3), d);
  const fixApplies = TERMS_ON.conversionFix && p4 > 0 && p4 < 1 && p3 > 0 && p3 < 1;
  const penOff = fixApplies ? logit(p3) - logit(p4) : 0;
  const sneakApplies = TERMS_ON.qbSneak && s.distance === 1;
  const sneakRow = Object.hasOwn(x.sneak, s.posteam) ? x.sneak[s.posteam] : undefined;
  const sneakOff = sneakApplies && sneakRow ? sneakRow.offset : 0;
  const pAll = shiftConvert(p4, penOff + sneakOff);
  const goAll = mix(pAll, b.go.wpConvert, b.go.wpFail);
  const dFix = fixApplies ? goAll - mix(shiftConvert(p4, sneakOff), b.go.wpConvert, b.go.wpFail) : 0;
  const dSneak = sneakApplies ? goAll - mix(shiftConvert(p4, penOff), b.go.wpConvert, b.go.wpFail) : 0;
  const go: ExperimentalOption<{ conversionProb: number; wpIfConvert: number | null; wpIfFail: number }> = {
    wp: goAll,
    wpAllTermsOff: b.wpGo,
    outcomes: { conversionProb: pAll, wpIfConvert: Number.isNaN(b.go.wpConvert) ? null : b.go.wpConvert, wpIfFail: b.go.wpFail },
    changedInputs: fixApplies || sneakApplies
      ? [{ id: 'conversionProb', label: 'Conversion chance', unit: 'probability', nfl4th: b.go.pConvert, experimental: pAll }]
      : [],
    residual: goAll - b.wpGo - dFix - dSneak,
  };

  // Punt: punter (m * u) plus coverage (k * (f + s)) yards, summed and
  // applied once through the shift rule.
  const yl = d.yardline100;
  const pu = resolvePunter(x, s);
  const mz = zoneValue(x.punterZones, yl);
  const kz = zoneValue(x.coverageZones, yl);
  const team = Object.hasOwn(x.coverage, s.posteam) ? x.coverage[s.posteam] : undefined;
  const punterShift = b.hasPunt && pu.u !== null && TERMS_ON.punter ? mz * pu.u : 0;
  const covShift = b.hasPunt && TERMS_ON.puntCoverage ? kz * (team ? team.effect : 0) : 0;
  const punterApplies = TERMS_ON.punter && b.hasPunt && pu.u !== null && mz > 0;
  const covApplies = TERMS_ON.puntCoverage && b.hasPunt && kz > 0;
  let punt: ExperimentalOption<{ wpAfterPunt: number }> | null = null;
  let dPunter = 0;
  let dCov = 0;
  if (b.hasPunt) {
    const total = punterShift + covShift;
    const full = shiftedPuntWp(m, d, b.punt, total);
    if (punterApplies) dPunter = full - shiftedPuntWp(m, d, b.punt, covShift);
    if (covApplies) dCov = full - shiftedPuntWp(m, d, b.punt, punterShift);
    punt = {
      wp: full,
      wpAllTermsOff: b.punt,
      outcomes: { wpAfterPunt: full },
      changedInputs: punterApplies || covApplies
        ? [{ id: 'puntShift', label: 'Punt net yards vs nfl4th', unit: 'yards', nfl4th: 0, experimental: total }]
        : [],
      residual: full - b.punt - dPunter - dCov,
    };
  }
  const fieldGoal = b.fgOk
    ? {
        wp: b.wpKick,
        wpAllTermsOff: b.wpKick,
        outcomes: { makeProb: b.fg.pMake, wpIfMake: b.fg.wpMake, wpIfMiss: b.fg.wpMiss },
        changedInputs: [],
        residual: 0,
      }
    : null;

  let call: 'go' | 'punt' | 'field goal' = 'go';
  let best = go.wp;
  if (fieldGoal && fieldGoal.wp > best) {
    call = 'field goal';
    best = fieldGoal.wp;
  }
  if (punt && punt.wp > best) call = 'punt';

  const punterNa = !b.hasPunt
    ? 'No punt option'
    : pu.unknown
      ? 'Punter unknown: league average'
      : pu.noHistory
        ? 'No punts before 2023: league average'
        : 'No punter adjustment in opponent territory';
  const values = [go.wp, pAll, ...(punt ? [punt.wp] : [])];
  if (values.some((v) => !Number.isFinite(v))) return { supported: false, reason: 'unavailable' };
  return {
    supported: true,
    modelId: x.modelId,
    label: x.label,
    dataAsOf: { ...x.dataAsOf },
    call,
    wpGo: go.wp,
    wpPunt: punt ? punt.wp : null,
    wpFieldGoal: fieldGoal ? fieldGoal.wp : null,
    options: { go, punt, fieldGoal },
    terms: [
      term('conversionFix', '4th-down conversion fix', 'go', fixApplies, dFix, 'No conversion chance to adjust'),
      term('qbSneak', `QB sneak usage (${s.posteam})`, 'go', sneakApplies, dSneak, 'Only on 4th and 1'),
      term('punter', pu.name ? `Punter (${pu.name})` : 'Punter', 'punt', punterApplies, dPunter, punterNa),
      term('puntCoverage', `Punt coverage (${s.posteam})`, 'punt', covApplies, dCov, 'No punt option'),
    ],
    flags: {
      punterUnknown: b.hasPunt && pu.unknown,
      punterNoHistory: b.hasPunt && pu.noHistory,
      coverageNoHistory: b.hasPunt && (team ? team.noHistory : true),
    },
  };
}

/** The experimental model's files, checked; null when any is missing or inconsistent. */
function loadExperimental(files: ModelFiles, version: string): Experimental | null {
  try {
    const e = files.terms.experimental;
    const tables = [files.sneak, files.punter, files.coverage, files.teamPunters];
    if (!e || tables.some((t) => !t || t.modelVersion !== version || t.season !== e.season)) return null;
    if (e.terms.join() !== TERM_IDS.join() || typeof e.modelId !== 'string' || typeof e.label !== 'string') return null;
    // The weekly tables come from one export run.
    const asOf = (a: { season: number; week: number }) => `${a.season}-${a.week}`;
    if ([files.sneak, files.coverage, files.teamPunters].some((t) => asOf(t.dataAsOf) !== asOf(e.dataAsOf))) return null;
    return {
      modelId: e.modelId,
      label: e.label,
      season: e.season,
      dataAsOf: { season: e.dataAsOf.season, week: e.dataAsOf.week },
      sneak: files.sneak.teams,
      punterZones: files.punter.zones,
      punters: files.punter.punters,
      coverageZones: files.coverage.zones,
      coverage: files.coverage.teams,
      teamPunters: files.teamPunters.teams,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Contract layer (src/core/export/contract.py, situation.py, recommend.py)

const SITE_TEAMS = new Set([
  'ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE', 'DAL', 'DEN', 'DET', 'GB',
  'HOU', 'IND', 'JAX', 'KC', 'LAC', 'LAR', 'LV', 'MIA', 'MIN', 'NE', 'NO', 'NYG',
  'NYJ', 'PHI', 'PIT', 'SEA', 'SF', 'TB', 'TEN', 'WAS',
]);
const ROOFS = new Set(['outdoors', 'dome', 'closed', 'open']);
const ENDGAME_SECONDS = 15;
/** nfl4th's games table starts in 2014 */
const MIN_SEASON = 2014;

type Common = EngineTrySituation;

/** situation.check: the contract checks, then the port's prepared row. */
function prepare(m: Model, s: Common, yardline100: number, ydstogo: number): { state: State; linesUnknown: boolean } | Unsupported {
  if (s.overtime) return { supported: false, reason: 'overtime' };
  const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  if (!isNum(s.secondsRemaining) || !isNum(s.halfSecondsRemaining)) return { supported: false, reason: 'unavailable' };
  // The clock is floored before the endgame check (roadmap decision 1).
  const gsr = Math.floor(s.secondsRemaining);
  const hsr = Math.floor(s.halfSecondsRemaining);
  if (gsr <= ENDGAME_SECONDS) return { supported: false, reason: 'endgame' };
  const ok =
    (gsr === hsr || gsr === hsr + 1800) &&
    hsr >= 0 && hsr <= 1800 &&
    SITE_TEAMS.has(s.posteam) && SITE_TEAMS.has(s.defteam) && s.posteam !== s.defteam &&
    (s.home === s.posteam || s.home === s.defteam) &&
    ROOFS.has(s.roof) &&
    isNum(s.season) && Math.trunc(s.season) >= MIN_SEASON &&
    isNum(s.timeoutsOffense) && s.timeoutsOffense >= 0 && s.timeoutsOffense <= 3 &&
    isNum(s.timeoutsDefense) && s.timeoutsDefense >= 0 && s.timeoutsDefense <= 3 &&
    isNum(s.scoreDiff) &&
    (s.spreadLine === null || isNum(s.spreadLine)) && (s.totalLine === null || isNum(s.totalLine));
  if (!ok) return { supported: false, reason: 'unavailable' };

  // Each missing line gets its own fallback (contract v3).
  const linesUnknown = s.spreadLine === null || s.totalLine === null;
  const spread = s.spreadLine === null ? 0 : s.spreadLine;
  const total = s.totalLine === null ? m.fallbackTotal : s.totalLine;

  // Quarter: first half when secondsRemaining = halfSecondsRemaining + 1800;
  // prepare_df rebuilds the same half and game clocks from it.
  const firstHalf = gsr - hsr >= 900;
  const qtr = firstHalf ? (hsr <= 900 ? 2 : 1) : hsr <= 900 ? 4 : 3;
  const season = Math.trunc(s.season);
  const homeTeam = s.home;
  const awayTeam = s.home === s.posteam ? s.defteam : s.posteam;
  const homeHasBall = s.posteam === homeTeam;
  const hok = s.homeOpeningKickoff ? 1 : 0;
  const gameSeconds = firstHalf ? hsr + 1800 : hsr;
  const elapsedShare = (3600 - gameSeconds) / 3600;
  const homeTotal = (total + spread) / 2;
  const awayTotal = (total - spread) / 2;
  const modelRoof = s.roof === 'open' || s.roof === 'closed' ? 'retractable' : s.roof;
  const state: State = {
    season,
    homeTeam,
    awayTeam,
    posteam: s.posteam,
    originalPosteam: s.posteam,
    qtr,
    halfSeconds: hsr,
    gameSeconds,
    down: 4,
    ydstogo,
    yardline100,
    scoreDiff: s.scoreDiff,
    homeOpeningKickoff: hok,
    homeReceive2hKo: qtr <= 2 ? (hok === 1 ? -1 : 1) : 0,
    homeTimeouts: homeHasBall ? s.timeoutsOffense : s.timeoutsDefense,
    awayTimeouts: homeHasBall ? s.timeoutsDefense : s.timeoutsOffense,
    posteamTimeouts: s.timeoutsOffense,
    defteamTimeouts: s.timeoutsDefense,
    spreadLine: spread,
    totalLine: total,
    posteamSpread: homeHasBall ? spread : -spread,
    posteamTotal: homeHasBall ? homeTotal : awayTotal,
    elapsedShare,
    spreadTime: spread * Math.exp(-4 * elapsedShare),
    era3: +(season > 2013 && season <= 2017),
    era4: +(season > 2017),
    modelRoof,
    // fg_model_roof: outdoors (raw roof) crossed with the 2020+ era.
    fgModelRoof: `${+(s.roof === 'outdoors')}${+(season >= 2020)}`,
  };
  return { state, linesUnknown };
}

/** model.mix: a branch with probability 0 contributes 0 even if undefined. */
function mix(p: number, wpSuccess: number, wpFail: number): number {
  return (p === 0 ? 0 : p * wpSuccess) + (p === 1 ? 0 : (1 - p) * wpFail);
}

/** No correction terms: each option's WP is its all-terms-off WP. */
const noTerms = (wp: number): TermBreakdown => ({ wpAllTermsOff: wp, terms: [], residual: 0 });

function recommendWith(m: Model, s: EngineFourthDownSituation): EngineFourthDownResult {
  const yl = s.yardline100;
  const dist = s.distance;
  const fieldOk = Number.isInteger(yl) && Number.isInteger(dist) && yl >= 1 && yl <= 99 && dist >= 1 && dist <= yl;
  const p = prepare(m, s, yl, dist);
  if ('supported' in p) return p;
  if (!fieldOk) return { supported: false, reason: 'unavailable' };
  const d = p.state;

  const go = goWp(m, d);
  const fg = fgWp(m, d);
  const punt = puntWp(m, d);
  const wpGo = mix(go.pConvert, go.wpConvert, go.wpFail);
  const wpKick = mix(fg.pMake, fg.wpMake, fg.wpMiss);
  const kickDistance = yl + m.kickDistanceOffset;
  const fgOk = kickDistance <= m.maxFieldGoalDistance;
  const hasPunt = !Number.isNaN(punt);

  // Highest WP; null options skipped; an exact tie goes to the first of go,
  // field goal, punt (the port's call rule).
  let call: 'go' | 'punt' | 'field goal' = 'go';
  let best = wpGo;
  if (fgOk && wpKick > best) {
    call = 'field goal';
    best = wpKick;
  }
  if (hasPunt && punt > best) call = 'punt';

  const values = [wpGo, go.pConvert, go.wpFail, ...(fgOk ? [wpKick, fg.pMake, fg.wpMake, fg.wpMiss] : []), ...(hasPunt ? [punt] : [])];
  if (values.some((v) => !Number.isFinite(v))) return { supported: false, reason: 'unavailable' };

  // The experimental model never changes or breaks nfl4th's result.
  let experimental: ExperimentalResult;
  try {
    experimental = experimentalResult(m, s, d, { wpGo, go, hasPunt, punt, fgOk, wpKick, fg });
  } catch {
    experimental = { supported: false, reason: 'unavailable' };
  }

  return {
    supported: true,
    call,
    wpGo,
    wpPunt: hasPunt ? punt : null,
    wpFieldGoal: fgOk ? wpKick : null,
    conversionProb: go.pConvert,
    fgMakeProb: fgOk ? fg.pMake : null,
    kickDistance,
    // No kicker term: a league-average kicker, and no input was missing.
    kickerId: null,
    flags: { temperatureUnknown: false, kickerUnknown: false, linesUnknown: p.linesUnknown },
    breakdown: {
      go: {
        // No convert branch (4th and more than 65): no convert WP, null.
        outcomes: { conversionProb: go.pConvert, wpIfConvert: Number.isNaN(go.wpConvert) ? null : go.wpConvert, wpIfFail: go.wpFail },
        terms: noTerms(wpGo),
      },
      punt: hasPunt ? { outcomes: { wpAfterPunt: punt }, terms: noTerms(punt) } : null,
      fieldGoal: fgOk
        ? { outcomes: { makeProb: fg.pMake, wpIfMake: fg.wpMake, wpIfMiss: fg.wpMiss }, terms: noTerms(wpKick) }
        : null,
    },
    experimental,
  };
}

function recommendTryWith(m: Model, s: EngineTrySituation): EngineTryResult {
  // The try row's own field position is never read; nflverse puts PATs at 15.
  const p = prepare(m, s, 15, 15);
  if ('supported' in p) return p;
  const t = tryWp(m, p.state);
  if (![t.wp0, t.wp1, t.wp2, t.conv1, t.conv2, t.go1, t.go2].every(Number.isFinite)) {
    return { supported: false, reason: 'unavailable' };
  }
  return {
    supported: true,
    // Kick only when strictly better: an exact tie goes for 2 (nfl4th).
    call: t.go1 > t.go2 ? 'kick' : 'go for 2',
    wpKick: t.go1,
    wpGoForTwo: t.go2,
    patMakeProb: t.conv1,
    twoPointConvProb: t.conv2,
    flags: { linesUnknown: p.linesUnknown },
    breakdown: {
      kick: { outcomes: { successProb: t.conv1, wpIfSuccess: t.wp1, wpIfFail: t.wp0 }, terms: noTerms(t.go1) },
      goForTwo: { outcomes: { successProb: t.conv2, wpIfSuccess: t.wp2, wpIfFail: t.wp0 }, terms: noTerms(t.go2) },
    },
  };
}

// ---------------------------------------------------------------------------
// Public API

let loaded: Model | null = null;

/**
 * Validate and install the exported model. Returns false (and leaves no
 * model loaded, so every call is 'unavailable') when the files don't match
 * this engine or the site's contract version.
 */
export function loadModel(files: ModelFiles, siteContractVersion: number): boolean {
  loaded = null;
  try {
    const man = files.manifest;
    if (man.contractVersion !== ENGINE_CONTRACT_VERSION || siteContractVersion !== ENGINE_CONTRACT_VERSION) return false;
    const v = man.modelVersion;
    const parts = [files.fdModel, files.epModel, files.homeWpModel, files.wpSpreadModel, files.twoPtModel, files.tables, files.terms];
    if (parts.some((f) => !f || f.modelVersion !== v)) return false;
    // nfl4th's own result has no correction terms; the experimental model's
    // live in terms.experimental and their own files (loadExperimental).
    if (files.terms.fourthDown.length || files.terms.try.length || Object.keys(files.terms.kickers).length) return false;
    const pt = files.tables.punt;
    const punt = new Map<number, PuntRow[]>();
    for (let i = 0; i < pt.yardline100.length; i++) {
      const rows = punt.get(pt.yardline100[i]) ?? [];
      rows.push({ after: pt.yardlineAfter[i], pct: pt.pct[i], muff: pt.muff[i] });
      punt.set(pt.yardline100[i], rows);
    }
    loaded = {
      version: v,
      kickDistanceOffset: man.kickDistanceOffset,
      maxFieldGoalDistance: man.maxFieldGoalDistance,
      fallbackTotal: man.fallbackTotalLine.value,
      fd: toBooster(files.fdModel),
      ep: toBooster(files.epModel),
      homeWp: toBooster(files.homeWpModel),
      wpSpread: toBooster(files.wpSpreadModel),
      twoPt: toBooster(files.twoPtModel),
      fgMakeProb: files.tables.fgMakeProb,
      punt,
      experimental: loadExperimental(files, v),
    };
    return true;
  } catch {
    loaded = null;
    return false;
  }
}

/** Unload the model (every call returns 'unavailable' again). */
export function unloadModel(): void {
  loaded = null;
}

export function isModelLoaded(): boolean {
  return loaded !== null;
}

/** The loaded model's version (e.g. "nfl4th-ecb7293"), or null. */
export function modelVersion(): string | null {
  return loaded?.version ?? null;
}

export function recommend(situation: EngineFourthDownSituation): EngineFourthDownResult {
  if (!loaded) return { supported: false, reason: 'unavailable' };
  try {
    return recommendWith(loaded, situation);
  } catch {
    return { supported: false, reason: 'unavailable' };
  }
}

export function recommendTry(situation: EngineTrySituation): EngineTryResult {
  if (!loaded) return { supported: false, reason: 'unavailable' };
  try {
    return recommendTryWith(loaded, situation);
  } catch {
    return { supported: false, reason: 'unavailable' };
  }
}
