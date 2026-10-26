import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { checkFourthDown, decode, encode } from '../src/lib/calculator/form.ts';
import { loadFourthDownModel, recommend, type FourthDownResult, type ModelFiles } from '../src/lib/fourth-down.ts';
import { breakdownHtml, comparisonHtml } from '../src/lib/model-compare/html.ts';
import { checkTeams, decodeTeams, encodeTeams, withTeams } from '../src/lib/model-compare/form.ts';
import { defaultPunterLabel, punterIds, punterMenu } from '../src/lib/model-compare/punters.ts';
import { breakdownView, comparisonView, signedPoints, type Comparable } from '../src/lib/model-compare/view.ts';
import { disagreeLine, weekList } from '../src/lib/model-compare/week.ts';
import type { DecisionsData } from '../src/data/types.ts';

const SEASON = 2026;
const ROOT = join(import.meta.dirname, '..');
const MODELS = join(ROOT, 'models', 'fourth-down');
const readJson = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const model = (f: string) => readJson(join(MODELS, f));
const DECISIONS = join(ROOT, 'src', 'data', 'decisions.json');
const decisions: DecisionsData | null = existsSync(DECISIONS) ? readJson(DECISIONS) : null;
const OFFSET = model('manifest.json').kickDistanceOffset;

/** The contract's label, word for word (docs/model-interface.md). */
const LABEL =
  'Experimental: nfl4th plus four adjustments (the 4th-down conversion fix, QB sneak usage, punter, and punt coverage). Confirmation in progress.';

function modelFiles(): ModelFiles {
  return {
    manifest: model('manifest.json'),
    fdModel: model('fd_model.json'),
    epModel: model('ep_model.json'),
    homeWpModel: model('home_wp_model.json'),
    wpSpreadModel: model('wp_spread_model.json'),
    twoPtModel: model('two_pt_model.json'),
    tables: model('tables.json'),
    terms: model('terms.json'),
    sneak: model('sneak.json'),
    punter: model('punter.json'),
    coverage: model('coverage.json'),
    teamPunters: model('teamPunters.json'),
  };
}

let loaded = false;
/** The page's path: the form from a query string, the teams and punter on top, then recommend(). */
function run(search: string, extraPunters: string[] = []): FourthDownResult {
  if (!loaded) loaded = loadFourthDownModel(modelFiles());
  assert.ok(loaded);
  const menu = punterMenu(model('teamPunters.json'), model('punter.json'), extraPunters);
  const teams = Object.keys(menu.team);
  const checked = checkFourthDown(decode(search, 'fourth-down', SEASON), SEASON);
  return recommend(withTeams(checked.situation!, decodeTeams(search, teams, punterIds(menu))));
}

test('signed points: two places, signed, and 0.00 under half a hundredth', () => {
  assert.equal(signedPoints(0.00557), '+0.56');
  assert.equal(signedPoints(-0.0123), '-1.23');
  assert.equal(signedPoints(0.00001), '0.00');
  assert.equal(signedPoints(-0.00004), '0.00');
});

test('the calculator default: both models, label word for word, experimental first, breakdown adds up', () => {
  const r = run('');
  assert.ok(r.supported && r.experimental.supported);
  const view = comparisonView(r, { team: 'BUF', kickOffset: OFFSET });
  assert.equal(view.kind, 'both');
  if (view.kind !== 'both') return;
  assert.equal(view.label, LABEL);
  assert.equal(view.disagree, r.experimental.call !== r.call);
  const html = comparisonHtml(view);
  assert.ok(html.indexOf('Experimental model') < html.indexOf("nfl4th's recommendation"));
  assert.ok(html.includes(LABEL));
  assert.match(view.asOf, /^Weekly tables through 2026 week \d+\.$/);

  // Every option: start + deltas + residual = experimental WP (the contract's identity).
  const e = r.experimental;
  for (const key of ['go', 'fieldGoal', 'punt'] as const) {
    const o = e.options[key];
    if (!o) continue;
    const sum = o.wpAllTermsOff + e.terms.reduce((s, t) => s + (t.options.includes(key) ? (t.wpDelta[key] ?? 0) : 0), 0) + o.residual;
    assert.ok(Math.abs(sum - o.wp) < 1e-9, key);
  }
  const b = breakdownView(e, r, OFFSET);
  assert.deepEqual(b.terms.map((t) => t.id), ['conversionFix', 'qbSneak', 'punter', 'puntCoverage']);
  assert.ok(breakdownHtml(b).includes('Residual'));
});

test('a term that does not apply shows its text, muted, and only under its own options', () => {
  const r = run('?togo=3');
  assert.ok(r.supported && r.experimental.supported);
  const b = breakdownView(r.experimental, r, OFFSET);
  const sneak = b.terms.find((t) => t.id === 'qbSneak')!;
  const go = b.columns.findIndex((c) => c.key === 'go');
  assert.deepEqual(sneak.cells[go], { value: 'Only on 4th and 1', muted: true });
  for (const [i, c] of sneak.cells.entries()) if (i !== go) assert.equal(c.value, '');
});

test('another season: nfl4th only, saying why', () => {
  const r = run('?season=2025');
  assert.ok(r.supported);
  const view = comparisonView(r, { team: 'BUF', kickOffset: OFFSET, tablesSeason: 2026 });
  assert.equal(view.kind, 'nfl4th-only');
  if (view.kind === 'nfl4th-only') assert.match(view.message, /2026 season only/);
});

test('teams and punter: defaults, bad values, equal teams, the query string, home carries over', () => {
  const menu = punterMenu(model('teamPunters.json'), model('punter.json'));
  const teams = Object.keys(menu.team);
  const ids = punterIds(menu);
  assert.deepEqual(decodeTeams('', teams, ids), { offense: 'BUF', defense: 'KC', punter: '' });
  assert.deepEqual(decodeTeams('?offense=xyz&defense=kc&punter=nope', teams, ids), { offense: 'BUF', defense: 'KC', punter: '' });
  assert.notEqual(decodeTeams('?offense=KC&defense=KC', teams, ids).defense, 'KC');
  assert.equal(checkTeams({ offense: 'KC', defense: 'KC', punter: '' }), 'Pick a different team from the offense.');

  const base = encode(decode('', 'fourth-down', SEASON), 'fourth-down');
  const query = encodeTeams(base, { offense: 'CIN', defense: 'BAL', punter: menu.current[0].id });
  assert.deepEqual(decodeTeams(query, teams, ids), { offense: 'CIN', defense: 'BAL', punter: menu.current[0].id });
  assert.ok(!encodeTeams(base, { offense: 'CIN', defense: 'BAL', punter: '' }).includes('punter'));

  const s = checkFourthDown(decode('?home=def', 'fourth-down', SEASON), SEASON).situation!;
  const t = withTeams(s, { offense: 'CIN', defense: 'BAL', punter: '' });
  assert.equal(t.home, 'BAL');
  assert.equal(t.punterId, undefined);
});

test("punter menu: each team's punter named, from teamPunters.json when punter.json has none", () => {
  const teamPunters = model('teamPunters.json');
  const punters = model('punter.json');
  const menu = punterMenu(teamPunters, punters, ['999999999']);
  assert.equal(Object.keys(menu.team).length, 32);
  for (const [abbr, p] of Object.entries(teamPunters.teams) as [string, { punterId: string | null; name: string | null }][]) {
    if (!p.punterId) continue;
    const expected = punters.punters[p.punterId]?.name ?? p.name;
    assert.equal(menu.team[abbr]!.name, expected, abbr);
    assert.equal(defaultPunterLabel(menu, abbr), `${abbr}'s most recent punter: ${expected}`);
  }
  assert.ok(menu.others.some((o) => o.id === '999999999' && o.label === 'Punter with ESPN id 999999999'));
  const ids = [...menu.current, ...menu.others].map((o) => o.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('the week list: latest week, newest first, an outcome-free disagreement count', { skip: !decisions }, () => {
  const order = ['2026_07_A', '2026_07_B'];
  const list = weekList(decisions!.fourthDowns, decisions!.season, (id) => (order.includes(id) ? id : null))!;
  assert.ok(list);
  assert.ok(list.items.every((i) => i.result.experimental?.supported));
  assert.equal(list.disagree, list.items.filter((i) => i.result.experimental!.supported && i.result.experimental!.call !== i.result.call).length);
  assert.match(disagreeLine(list), /^The models disagree on \d+ of these \d+ 4th downs?\.$/);
  for (let i = 1; i < list.items.length; i++) {
    const [a, b] = [list.items[i - 1], list.items[i]];
    if (a.gameId === b.gameId) assert.ok(a.playId > b.playId);
  }
  // Nothing about what happened: no play text, team call or WP cost in an item.
  const html = list.items.map((i) => comparisonHtml(comparisonView(i.result, { team: i.team, kickOffset: OFFSET }))).join('');
  assert.ok(!/punts \d+ yards|wpCost|Questionable/.test(html));
});

test('loading a stored play into the calculator gives the stored numbers', { skip: !decisions }, () => {
  const list = weekList(decisions!.fourthDowns, decisions!.season, () => null)!;
  const asOf = model('manifest.json').experimental.dataAsOf;
  const comparable = list.items.filter((i) => {
    const e = i.result.experimental!;
    return e.supported && e.dataAsOf.season === asOf.season && e.dataAsOf.week === asOf.week;
  });
  let checked = 0;
  for (const item of comparable) {
    const r = run(encodeTeams(encode(item.values, 'fourth-down'), item.values), [item.values.punter]);
    if (!r.supported || !r.experimental.supported) continue;
    const stored = item.result.experimental as Extract<Comparable['experimental'], { supported: true }>;
    // Stored values are rounded to 5 places.
    assert.ok(Math.abs(r.experimental.wpGo - stored.wpGo) < 1e-4, item.key);
    assert.equal(r.experimental.call, stored.call, item.key);
    checked += 1;
  }
  assert.equal(checked, comparable.length);
});
