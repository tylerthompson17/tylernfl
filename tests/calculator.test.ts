import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  checkFourthDown,
  checkTry,
  clockSeconds,
  decode,
  defaults,
  encode,
  isGoalToGo,
  parseClock,
  situationLine,
  valuesOf,
  yardline100Of,
} from '../src/lib/calculator/form.ts';
import { fourthDownView, pct, tryView } from '../src/lib/calculator/format.ts';
import {
  loadFourthDownModel,
  recommend,
  recommendTry,
  type FourthDownResult,
  type FourthDownSituation,
  type ModelFiles,
  type TryResult,
  type TrySituation,
} from '../src/lib/fourth-down.ts';

const SEASON = 2026;
const MODELS = join(import.meta.dirname, '..', 'models', 'fourth-down');
const FIXTURES = join(import.meta.dirname, 'fixtures', 'fourth-down');
const readJson = (dir: string, f: string) => JSON.parse(readFileSync(join(dir, f), 'utf8'));
const fallbacks = { total: { value: 44.5, season: 2025 } };

function modelFiles(): ModelFiles {
  return {
    manifest: readJson(MODELS, 'manifest.json'),
    fdModel: readJson(MODELS, 'fd_model.json'),
    epModel: readJson(MODELS, 'ep_model.json'),
    homeWpModel: readJson(MODELS, 'home_wp_model.json'),
    wpSpreadModel: readJson(MODELS, 'wp_spread_model.json'),
    twoPtModel: readJson(MODELS, 'two_pt_model.json'),
    tables: readJson(MODELS, 'tables.json'),
    terms: readJson(MODELS, 'terms.json'),
  };
}

const ok = <T,>(r: { errors: object; situation: T | null }): T => {
  assert.deepEqual(r.errors, {});
  return r.situation!;
};

test('defaults: 4th and 2 at midfield, tied, spread 0, total 44', () => {
  const s = ok(checkFourthDown(defaults('fourth-down', SEASON), SEASON));
  assert.equal(s.yardline100, 50);
  assert.equal(s.distance, 2);
  assert.equal(s.scoreDiff, 0);
  assert.equal(s.spreadLine, 0);
  assert.equal(s.totalLine, 44);
  assert.equal(s.season, SEASON);
  assert.equal(situationLine(defaults('fourth-down', SEASON)), '4th and 2 at midfield');
});

test('field position and goal to go', () => {
  assert.equal(yardline100Of('own', 20), 80);
  assert.equal(yardline100Of('opp', 20), 20);
  assert.equal(yardline100Of('own', 50), 50);
  const goal = { ...defaults('fourth-down', SEASON), side: 'opp', yl: '3', togo: '3' };
  assert.equal(isGoalToGo(goal), true);
  assert.equal(situationLine(goal), "4th and goal at the opponent's 3");
  assert.equal(isGoalToGo({ ...goal, togo: '2' }), false);
  assert.equal(situationLine({ ...goal, side: 'own', yl: '25', togo: '7' }), '4th and 7 at own 25');
});

test('validation: yards to go, clock, timeouts', () => {
  const base = defaults('fourth-down', SEASON);
  assert.match(checkFourthDown({ ...base, side: 'opp', yl: '3', togo: '4' }, SEASON).errors.togo!, /3 yards to the goal line/);
  assert.match(checkFourthDown({ ...base, side: 'opp', yl: '1', togo: '2' }, SEASON).errors.togo!, /1 yard to/);
  assert.equal(checkFourthDown({ ...base, togo: '0' }, SEASON).errors.togo !== undefined, true);
  assert.equal(checkFourthDown({ ...base, yl: '51' }, SEASON).errors.yl !== undefined, true);
  assert.equal(checkFourthDown({ ...base, clock: '15:01' }, SEASON).errors.clock, 'A quarter is 15:00 long.');
  assert.equal(checkFourthDown({ ...base, clock: '15:00' }, SEASON).errors.clock, undefined);
  assert.equal(checkFourthDown({ ...base, clock: '9:75' }, SEASON).errors.clock !== undefined, true);
  assert.equal(checkFourthDown({ ...base, to: '4' }, SEASON).errors.to, 'Timeouts are 0 to 3.');
  assert.equal(checkFourthDown({ ...base, oppto: '-1' }, SEASON).errors.oppto, 'Timeouts are 0 to 3.');
  assert.equal(checkFourthDown({ ...base, to: '1.5' }, SEASON).errors.to, 'Timeouts are 0 to 3.');
  assert.equal(checkFourthDown({ ...base, to: '4' }, SEASON).situation, null);
  assert.equal(checkTry({ ...defaults('try', SEASON), pts: '' }, SEASON).errors.pts !== undefined, true);
});

test('clock: quarter and time left to seconds', () => {
  assert.equal(parseClock('10:00'), 600);
  assert.equal(parseClock('0:07'), 7);
  assert.equal(parseClock('45'), 45);
  assert.equal(parseClock('1:5'), null);
  assert.deepEqual(clockSeconds(1, 900), { game: 3600, half: 1800 });
  assert.deepEqual(clockSeconds(2, 120), { game: 1920, half: 120 });
  assert.deepEqual(clockSeconds(3, 600), { game: 1500, half: 1500 });
  assert.deepEqual(clockSeconds(4, 30), { game: 30, half: 30 });
});

test('spread: the offense line as a sportsbook writes it, stored as home favored by', () => {
  const base = defaults('fourth-down', SEASON);
  assert.equal(ok(checkFourthDown({ ...base, spread: '-3', home: 'off' }, SEASON)).spreadLine, 3);
  assert.equal(ok(checkFourthDown({ ...base, spread: '-3', home: 'def' }, SEASON)).spreadLine, -3);
  assert.equal(ok(checkFourthDown({ ...base, spread: '6.5', home: 'off' }, SEASON)).spreadLine, -6.5);
  const blank = ok(checkFourthDown({ ...base, spread: '', total: '' }, SEASON));
  assert.equal(blank.spreadLine, null);
  assert.equal(blank.totalLine, null);
  assert.equal(checkFourthDown({ ...base, spread: 'x' }, SEASON).errors.spread !== undefined, true);
});

test('opening kickoff maps to the home team flag', () => {
  const base = defaults('fourth-down', SEASON);
  const flag = (home: string, ko: string) => ok(checkFourthDown({ ...base, home, ko }, SEASON)).homeOpeningKickoff;
  assert.equal(flag('off', 'off'), true);
  assert.equal(flag('off', 'def'), false);
  assert.equal(flag('def', 'off'), false);
  assert.equal(flag('def', 'def'), true);
});

test('URL: encode and decode round trip, bad menu values fall back', () => {
  const values = { ...defaults('fourth-down', SEASON), side: 'opp', yl: '35', togo: '7', q: '4', clock: '2:10', spread: '-3.5', total: '' };
  const query = encode(values, 'fourth-down');
  assert.equal(
    query,
    '?side=opp&yl=35&togo=7&q=4&clock=2:10&pts=10&opp=10&to=3&oppto=3&home=off&ko=off&roof=outdoors&spread=-3.5&total=&season=2026',
  );
  assert.deepEqual(decode(query, 'fourth-down', SEASON), values);
  assert.deepEqual(decode('', 'try', SEASON), defaults('try', SEASON));
  const odd = decode('?roof=stadium&q=5&season=1999&yl=abc', 'fourth-down', SEASON);
  assert.equal(odd.roof, 'outdoors');
  assert.equal(odd.q, '3');
  assert.equal(odd.season, '2026');
  assert.equal(odd.yl, 'abc');
  assert.equal(checkFourthDown(odd, SEASON).errors.yl !== undefined, true);
  assert.equal(encode(defaults('try', SEASON), 'try').includes('yl='), false);
});

test('format: percents, margin, null options, n/a and the tie rule', () => {
  assert.equal(pct(0.52202), '52.2%');
  const breakdownTerms = (wp: number) => ({ wpAllTermsOff: wp, terms: [], residual: 0 });
  const result: FourthDownResult = {
    supported: true,
    call: 'go',
    wpGo: 0.1,
    wpPunt: 0.1,
    wpFieldGoal: null,
    conversionProb: 0,
    fgMakeProb: null,
    kickDistance: 108,
    kickerId: null,
    flags: { temperatureUnknown: false, kickerUnknown: false, linesUnknown: true },
    breakdown: {
      go: { outcomes: { conversionProb: 0, wpIfConvert: null, wpIfFail: 0.1 }, terms: breakdownTerms(0.1) },
      punt: { outcomes: { wpAfterPunt: 0.1 }, terms: breakdownTerms(0.1) },
      fieldGoal: null,
    },
  };
  const view = fourthDownView(result, fallbacks);
  assert.equal(view.kind, 'result');
  if (view.kind !== 'result') return;
  assert.equal(view.call, 'Go for it');
  assert.deepEqual(view.options.map((o) => o.key), ['go', 'punt']);
  assert.match(view.margin, /^Exactly tied with a punt/);
  const ifConvert = view.options[0].parts[1];
  assert.equal(ifConvert.value, 'n/a');
  assert.match(ifConvert.note!, /No gain can reach/);
  assert.deepEqual(view.skipped.map((s) => s.label), ['Field goal']);
  assert.match(view.skipped[0].reason, /108-yard kick/);
  assert.match(view.notes[0], /44\.5, the median total of the 2025 season/);

  assert.deepEqual(fourthDownView({ supported: false, reason: 'unavailable' }, fallbacks).kind, 'unsupported');
  const ot = fourthDownView({ supported: false, reason: 'overtime' }, fallbacks);
  assert.equal(ot.kind === 'unsupported' && /Overtime/.test(ot.message), true);
});

test('before the model loads, recommend() is unavailable and the page says so', () => {
  const s = ok(checkFourthDown(defaults('fourth-down', SEASON), SEASON));
  const view = fourthDownView(recommend(s), fallbacks);
  assert.equal(view.kind, 'unsupported');
  assert.match(view.kind === 'unsupported' ? view.message : '', /unavailable/);
  // A file from another contract version loads nothing.
  const files = modelFiles();
  assert.equal(loadFourthDownModel({ ...files, manifest: { ...files.manifest, contractVersion: 3 } }), false);
  assert.deepEqual(recommend(s), { supported: false, reason: 'unavailable' });
  assert.deepEqual(recommendTry(ok(checkTry(defaults('try', SEASON), SEASON))), { supported: false, reason: 'unavailable' });
});

/**
 * Fixtures through the page's own path: situation to form, form to query
 * string, query string back to a form, form to situation, recommend().
 * The page plays BUF and KC as stand-ins for any two teams, which the
 * baseline never reads, so each fixture's teams are put on the same sides.
 */
function throughPage(situation: FourthDownSituation): FourthDownSituation {
  return ok(checkFourthDown(decode(encode(valuesOf(situation), 'fourth-down'), 'fourth-down', SEASON), SEASON));
}

function throughTryPage(situation: TrySituation): TrySituation {
  return ok(checkTry(decode(encode(valuesOf(situation), 'try'), 'try', SEASON), SEASON));
}

const asPage = <S extends { posteam: string; defteam: string; home: string }>(s: S): S => ({
  ...s,
  posteam: 'BUF',
  defteam: 'KC',
  home: s.home === s.posteam ? 'BUF' : 'KC',
});

function close(actual: unknown, expected: unknown, path = ''): void {
  if (typeof expected === 'number') {
    assert.equal(typeof actual, 'number', path);
    assert.ok(Math.abs((actual as number) - expected) <= 1e-6, `${path}: ${actual} vs ${expected}`);
  } else if (expected && typeof expected === 'object') {
    assert.deepEqual(Object.keys(actual as object).sort(), Object.keys(expected).sort(), path);
    for (const [k, v] of Object.entries(expected)) close((actual as Record<string, unknown>)[k], v, `${path}.${k}`);
  } else assert.equal(actual, expected, path);
}

test('recommend() and recommendTry() through the page match the fixtures', () => {
  assert.equal(loadFourthDownModel(modelFiles()), true);
  const fourth = readJson(FIXTURES, 'fourth_down.json').cases as { name: string; situation: FourthDownSituation; expected: FourthDownResult }[];
  // Whole-second clocks the form can express, a spread of situations:
  // goal to go, a long field goal left out, a punt left out, overtime,
  // the endgame, 4th and more than 65, both home sides, a missing line.
  const picks = fourth.filter(
    (c) =>
      Number.isInteger(c.situation.secondsRemaining) &&
      Number.isInteger(c.situation.halfSecondsRemaining) &&
      c.situation.season >= 2014 &&
      c.situation.scoreDiff > -200,
  );
  const want = [
    (c: (typeof picks)[number]) => c.situation.distance === c.situation.yardline100 && c.expected.supported,
    (c: (typeof picks)[number]) => c.expected.supported && c.expected.wpFieldGoal === null,
    (c: (typeof picks)[number]) => c.expected.supported && c.expected.wpPunt === null && c.expected.wpFieldGoal !== null,
    (c: (typeof picks)[number]) => c.expected.supported && c.expected.breakdown.go.outcomes.wpIfConvert === null,
    (c: (typeof picks)[number]) => c.expected.supported && c.situation.home !== c.situation.posteam,
    (c: (typeof picks)[number]) => c.expected.supported && c.expected.flags.linesUnknown,
    (c: (typeof picks)[number]) => c.expected.supported && c.expected.call === 'punt',
    (c: (typeof picks)[number]) => !c.expected.supported && c.expected.reason === 'overtime',
    (c: (typeof picks)[number]) => !c.expected.supported && c.expected.reason === 'endgame',
  ];
  let checked = 0;
  for (const match of want) {
    const c = picks.find(match);
    if (!c) continue;
    const s = throughPage(c.situation);
    // Overtime carries no clock the form keeps; every other field round trips.
    const { kickerId: _kicker, ...rest } = c.situation;
    if (!c.situation.overtime) close(s, { ...asPage(rest), temp: null }, c.name);
    close(recommend(s), c.expected, c.name);
    const view = fourthDownView(recommend(s), fallbacks);
    if (c.expected.supported && view.kind === 'result') {
      assert.equal(view.options.find((o) => o.best)?.wp, pct(c.expected[`wp${{ go: 'Go', punt: 'Punt', 'field goal': 'FieldGoal' }[c.expected.call]}` as 'wpGo']!));
    }
    checked += 1;
  }
  assert.ok(checked >= 7, `only ${checked} fixture kinds found`);

  const tries = readJson(FIXTURES, 'try.json').cases as { name: string; situation: TrySituation; expected: TryResult }[];
  const tryPicks = [
    tries.find((c) => c.expected.supported && c.expected.call === 'kick'),
    tries.find((c) => c.expected.supported && c.expected.call === 'go for 2'),
  ].filter(Boolean) as typeof tries;
  assert.equal(tryPicks.length, 2);
  for (const c of tryPicks) {
    const s = throughTryPage(c.situation);
    close(recommendTry(s), c.expected, c.name);
    const view = tryView(recommendTry(s), fallbacks);
    assert.equal(view.kind === 'result' && view.call, c.expected.supported && (c.expected.call === 'kick' ? 'Kick the extra point' : 'Go for 2'));
  }
});
