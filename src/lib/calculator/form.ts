/**
 * The 4th down calculator's inputs: defaults, the URL query string, checks,
 * and the contract situation built from them (docs/model-interface.md). A
 * form is kept as the strings its fields hold, the same shape the query
 * string carries, so a shared link and a typed form go through one path:
 * decode, validate, then recommend(). The page's script (dom.ts) only moves
 * values between the fields and these functions.
 */
import type { FourthDownSituation, Roof, TrySituation } from '../fourth-down.ts';

export type CalculatorKind = 'fourth-down' | 'try';

export const QUARTERS = ['1', '2', '3', '4', 'OT'] as const;

export const ROOFS: { value: Roof; label: string }[] = [
  { value: 'outdoors', label: 'Outdoors' },
  { value: 'dome', label: 'Dome' },
  { value: 'closed', label: 'Retractable, closed' },
  { value: 'open', label: 'Retractable, open' },
];

/** nfl4th's game table starts in 2014; the engine returns unavailable before it. */
export const FIRST_SEASON = 2014;

/**
 * The baseline reads no team identity, only which side is home, but the
 * contract wants two site teams. These stand in until the page picks teams
 * (when the model is team-adjusted).
 */
const OFFENSE_TEAM = 'BUF';
const DEFENSE_TEAM = 'KC';

/** Every field, by its query string key, in the order the URL writes them. */
const FOURTH_DOWN_FIELDS = [
  'side', 'yl', 'togo', 'q', 'clock', 'pts', 'opp', 'to', 'oppto', 'home', 'ko', 'roof', 'spread', 'total', 'season',
] as const;
const TRY_FIELDS = ['q', 'clock', 'pts', 'opp', 'to', 'oppto', 'home', 'ko', 'roof', 'spread', 'total', 'season'] as const;

export type Field = (typeof FOURTH_DOWN_FIELDS)[number];
export type FormValues = Partial<Record<Field, string>>;
export type FieldErrors = Partial<Record<Field, string>>;

export const fieldsOf = (kind: CalculatorKind): readonly Field[] =>
  kind === 'fourth-down' ? FOURTH_DOWN_FIELDS : TRY_FIELDS;

/** Fields that are menus: a value from the URL outside these falls back to the default. */
function choicesOf(field: Field, season: number): readonly string[] | null {
  switch (field) {
    case 'side':
      return ['own', 'opp'];
    case 'q':
      return QUARTERS;
    case 'home':
    case 'ko':
      return ['off', 'def'];
    case 'roof':
      return ROOFS.map((r) => r.value);
    case 'season':
      return seasonsUpTo(season).map(String);
    default:
      return null;
  }
}

/** Seasons the menu offers, newest first. */
export function seasonsUpTo(season: number): number[] {
  const out: number[] = [];
  for (let s = season; s >= FIRST_SEASON; s--) out.push(s);
  return out;
}

/**
 * A 4th and 2 at midfield in a tied game, pregame spread 0 and total 44;
 * the try defaults to a team that just scored to trail by 2 late.
 */
export function defaults(kind: CalculatorKind, season: number): FormValues {
  const game = {
    to: '3',
    oppto: '3',
    home: 'off',
    ko: 'off',
    roof: 'outdoors',
    spread: '0',
    total: '44',
    season: String(season),
  };
  return kind === 'fourth-down'
    ? { side: 'own', yl: '50', togo: '2', q: '3', clock: '10:00', pts: '10', opp: '10', ...game }
    : { q: '4', clock: '5:00', pts: '20', opp: '22', ...game };
}

/**
 * Read a query string. Missing fields take the default; a menu value it
 * does not offer does too. Typed fields keep what was shared, so a bad
 * value shows its error instead of quietly changing.
 */
export function decode(search: string, kind: CalculatorKind, season: number): FormValues {
  const params = new URLSearchParams(search);
  const base = defaults(kind, season);
  const out: FormValues = {};
  for (const field of fieldsOf(kind)) {
    const raw = params.get(field);
    const choices = choicesOf(field, season);
    if (raw === null || (choices && !choices.includes(raw))) out[field] = base[field];
    else out[field] = raw.trim().slice(0, 12);
  }
  return out;
}

/** The query string for a form, every field in a fixed order ("?side=own&yl=50..."). */
export function encode(values: FormValues, kind: CalculatorKind): string {
  const params = new URLSearchParams();
  for (const field of fieldsOf(kind)) params.set(field, (values[field] ?? '').trim());
  return `?${params.toString().replaceAll('%3A', ':')}`;
}

const INTEGER = /^-?\d+$/;
const NUMBER = /^-?(\d+(\.\d*)?|\.\d+)$/;

function integerIn(value: string | undefined, lo: number, hi: number): number | null {
  const v = (value ?? '').trim();
  if (!INTEGER.test(v)) return null;
  const n = Number(v);
  return n >= lo && n <= hi ? n : null;
}

/** "10:00", "3:07", "0:45" or plain seconds ("45") to seconds; null when not a clock. */
export function parseClock(value: string | undefined): number | null {
  const v = (value ?? '').trim();
  const m = /^(\d{1,2}):([0-5]\d)$/.exec(v);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  return /^\d{1,3}$/.test(v) ? Number(v) : null;
}

/** Yards to the opponent's goal line from the form's side and yard line. */
export function yardline100Of(side: string | undefined, yardLine: number): number {
  return side === 'opp' || yardLine === 50 ? yardLine : 100 - yardLine;
}

/** Seconds left in the game and in the half, from a regulation quarter and its clock. */
export function clockSeconds(quarter: number, clock: number): { game: number; half: number } {
  return { game: (4 - quarter) * 900 + clock, half: (quarter % 2 === 1 ? 900 : 0) + clock };
}

export type Checked<S> = { errors: FieldErrors; situation: S | null };

/** What both decisions share, checked. */
function checkGame(values: FormValues, season: number, errors: FieldErrors) {
  const overtime = values.q === 'OT';
  const quarter = overtime ? 4 : Number(values.q);
  const clock = parseClock(values.clock);
  if (clock === null) errors.clock = 'Enter the time left as minutes and seconds, like 10:00.';
  else if (clock > 900) errors.clock = 'A quarter is 15:00 long.';

  const pts = integerIn(values.pts, 0, 199);
  const opp = integerIn(values.opp, 0, 199);
  if (pts === null) errors.pts = 'Enter a score from 0 up.';
  if (opp === null) errors.opp = 'Enter a score from 0 up.';

  const to = integerIn(values.to, 0, 3);
  const oppto = integerIn(values.oppto, 0, 3);
  if (to === null) errors.to = 'Timeouts are 0 to 3.';
  if (oppto === null) errors.oppto = 'Timeouts are 0 to 3.';

  const line = (value: string | undefined, field: 'spread' | 'total', lo: number, hi: number) => {
    const v = (value ?? '').trim();
    if (v === '') return null;
    const n = NUMBER.test(v) ? Number(v) : NaN;
    if (!(n >= lo && n <= hi)) {
      errors[field] = field === 'spread' ? 'Enter a spread from -40 to 40, or leave it blank.' : 'Enter a total from 1 to 100, or leave it blank.';
    }
    return n;
  };
  // The offense's line as a sportsbook writes it (-3: favored by 3);
  // spreadLine is points the home team is favored by.
  const offenseLine = line(values.spread, 'spread', -40, 40);
  const total = line(values.total, 'total', 1, 100);
  const offenseHome = values.home !== 'def';
  const favoredBy = offenseLine === null ? null : -offenseLine;
  const spreadLine = favoredBy === null ? null : offenseHome ? favoredBy : -favoredBy;

  const seasonValue = integerIn(values.season, FIRST_SEASON, season);
  if (seasonValue === null) errors.season = `Pick a season from ${FIRST_SEASON} to ${season}.`;

  const time = clockSeconds(quarter, clock ?? 0);
  return {
    season: seasonValue ?? season,
    posteam: OFFENSE_TEAM,
    defteam: DEFENSE_TEAM,
    home: offenseHome ? OFFENSE_TEAM : DEFENSE_TEAM,
    overtime,
    // Not read in overtime; the clock as entered still fills them.
    secondsRemaining: time.game,
    halfSecondsRemaining: time.half,
    scoreDiff: (pts ?? 0) - (opp ?? 0),
    timeoutsOffense: to ?? 0,
    timeoutsDefense: oppto ?? 0,
    // Which team took the opening kickoff, as the home team's flag.
    homeOpeningKickoff: (values.ko !== 'def') === offenseHome,
    roof: (ROOFS.find((r) => r.value === values.roof)?.value ?? 'outdoors') as Roof,
    spreadLine: spreadLine === null || Number.isNaN(spreadLine) ? null : spreadLine + 0,
    totalLine: total === null || Number.isNaN(total) ? null : total,
  };
}

/** Check a 4th down form and build its situation (null while any field is wrong). */
export function checkFourthDown(values: FormValues, season: number): Checked<FourthDownSituation> {
  const errors: FieldErrors = {};
  const game = checkGame(values, season, errors);
  const yl = integerIn(values.yl, 1, 50);
  if (yl === null) errors.yl = 'Enter a yard line from 1 to 50.';
  const yardline100 = yardline100Of(values.side, yl ?? 50);
  const togo = integerIn(values.togo, 1, 99);
  if (togo === null) errors.togo = 'Enter the yards to go, 1 or more.';
  else if (yl !== null && togo > yardline100) {
    errors.togo = `It is ${yardline100} ${yardline100 === 1 ? 'yard' : 'yards'} to the goal line, so no more than ${yardline100} to go.`;
  }
  if (Object.keys(errors).length) return { errors, situation: null };
  // The baseline reads neither: a league-average kicker, no temperature.
  return { errors, situation: { ...game, yardline100, distance: togo!, temp: null } };
}

/** Check a try form and build its situation. Scores are after the touchdown, before the try. */
export function checkTry(values: FormValues, season: number): Checked<TrySituation> {
  const errors: FieldErrors = {};
  const game = checkGame(values, season, errors);
  return Object.keys(errors).length ? { errors, situation: null } : { errors, situation: game };
}

/** "4th and 2 at midfield", "4th and goal at the opponent's 3", "4th and 7 at own 25". */
export function situationLine(values: FormValues): string | null {
  const yl = integerIn(values.yl, 1, 50);
  const togo = integerIn(values.togo, 1, 99);
  if (yl === null || togo === null) return null;
  const yardline100 = yardline100Of(values.side, yl);
  if (togo > yardline100) return null;
  const spot = yl === 50 ? 'midfield' : values.side === 'opp' ? `the opponent's ${yl}` : `own ${yl}`;
  return `4th and ${togo === yardline100 ? 'goal' : togo} at ${spot}`;
}

/** Goal to go: the line to gain is the goal line. */
export function isGoalToGo(values: FormValues): boolean {
  const yl = integerIn(values.yl, 1, 50);
  const togo = integerIn(values.togo, 1, 99);
  return yl !== null && togo !== null && togo === yardline100Of(values.side, yl);
}

/**
 * The form for a contract situation, the inverse of checkFourthDown for
 * situations the form can express (a regulation clock in whole seconds).
 * Used by the tests to put fixtures through the page's own path.
 */
export function valuesOf(s: FourthDownSituation | TrySituation): FormValues {
  const firstHalf = s.secondsRemaining - s.halfSecondsRemaining >= 900;
  const halfQuarter = s.halfSecondsRemaining > 900 ? 0 : 1;
  const quarter = (firstHalf ? 1 : 3) + halfQuarter;
  const clock = s.halfSecondsRemaining - (halfQuarter === 0 ? 900 : 0);
  const offenseHome = s.home === s.posteam;
  const favoredBy = s.spreadLine === null ? null : offenseHome ? s.spreadLine : -s.spreadLine;
  const values: FormValues = {
    q: s.overtime ? 'OT' : String(quarter),
    clock: `${Math.floor(clock / 60)}:${String(clock % 60).padStart(2, '0')}`,
    pts: String(Math.max(s.scoreDiff, 0)),
    opp: String(Math.max(-s.scoreDiff, 0)),
    to: String(s.timeoutsOffense),
    oppto: String(s.timeoutsDefense),
    home: offenseHome ? 'off' : 'def',
    ko: s.homeOpeningKickoff === offenseHome ? 'off' : 'def',
    roof: s.roof,
    spread: favoredBy === null ? '' : String(-favoredBy + 0),
    total: s.totalLine === null ? '' : String(s.totalLine),
    season: String(s.season),
  };
  if ('yardline100' in s) {
    values.side = s.yardline100 > 50 ? 'own' : 'opp';
    values.yl = String(s.yardline100 > 50 ? 100 - s.yardline100 : s.yardline100);
    values.togo = String(s.distance);
  }
  return values;
}
