// GENERATED FROM fourth-down (js/engine.test.ts). DO NOT EDIT: the model-delivery PR overwrites this file.
/**
 * Equivalence of the browser engine with the Python model (milestone 4).
 *
 * Reads the export written by scripts/export_model.py (MODELS_DIR and
 * FIXTURES_DIR, default build/export/models and build/export/fixtures) and
 * runs every fixture through recommend()/recommendTry().
 * Rules (roadmap export decision 1): every probability within 1e-6 of
 * Python; calls, null options, flags, reason codes, kick distance and the
 * shape of the result exact.
 *
 * The default run checks a seeded sample (300 4th downs, 100 tries, the same
 * ones every run) so it stays a few seconds; ENGINE_FIXTURES=all checks every
 * fixture, which the weekly model-delivery Action does (about a minute).
 *
 * Run: npm test   (all fixtures: npm run test:fourth-down-engine)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  ENGINE_CONTRACT_VERSION, isModelLoaded, loadModel, modelVersion, recommend, recommendTry, unloadModel,
  type ModelFiles,
} from '../src/lib/fourth-down-engine.ts';

const TOL = 1e-6;
/** Fixtures per file in the default run; ENGINE_FIXTURES=all runs every one. */
const SAMPLE_SIZE: Record<string, number> = { 'fourth_down.json': 300, 'try.json': 100 };
const SAMPLE_SEED = 20261022;
const FULL = process.env.ENGINE_FIXTURES === 'all';
const MODELS_DIR = process.env.MODELS_DIR ?? join(import.meta.dirname, '..', 'models', 'fourth-down');
const FIXTURES_DIR = process.env.FIXTURES_DIR ?? join(import.meta.dirname, 'fixtures', 'fourth-down');
const readModel = (f: string) => JSON.parse(readFileSync(join(MODELS_DIR, f), 'utf8'));
const readFixture = (f: string) => JSON.parse(readFileSync(join(FIXTURES_DIR, f), 'utf8'));

function files(): ModelFiles {
  return {
    manifest: readModel('manifest.json'),
    fdModel: readModel('fd_model.json'),
    epModel: readModel('ep_model.json'),
    homeWpModel: readModel('home_wp_model.json'),
    wpSpreadModel: readModel('wp_spread_model.json'),
    twoPtModel: readModel('two_pt_model.json'),
    tables: readModel('tables.json'),
    terms: readModel('terms.json'),
  };
}

/** Exact-match fields among the numbers: everything else numeric is a probability. */
const EXACT_NUMBERS = new Set(['kickDistance']);

/**
 * Walk expected and actual together. Returns mismatches that break the
 * exact rules, and records the largest probability difference per field.
 */
function compare(exp: unknown, act: unknown, path: string, worst: Map<string, number>, bad: string[]) {
  if (typeof exp === 'number' && typeof act === 'number') {
    const field = path.split('.').pop()!;
    if (EXACT_NUMBERS.has(field)) {
      if (exp !== act) bad.push(`${path}: ${act} != ${exp}`);
      return;
    }
    const d = Math.abs(exp - act);
    const key = path.replace(/^\[[^\]]*\]\./, '');
    worst.set(key, Math.max(worst.get(key) ?? 0, d));
    if (!(d <= TOL)) bad.push(`${path}: ${act} vs ${exp} (diff ${d.toExponential(2)})`);
    return;
  }
  if (exp === null || act === null || typeof exp !== 'object' || typeof act !== 'object') {
    if (exp !== act) bad.push(`${path}: ${JSON.stringify(act)} != ${JSON.stringify(exp)}`);
    return;
  }
  if (Array.isArray(exp) !== Array.isArray(act)) {
    bad.push(`${path}: array mismatch`);
    return;
  }
  const ek = Object.keys(exp).sort();
  const ak = Object.keys(act).sort();
  if (ek.join() !== ak.join()) {
    bad.push(`${path}: keys ${ak.join(',')} != ${ek.join(',')}`);
    return;
  }
  for (const k of ek) compare((exp as any)[k], (act as any)[k], `${path}.${k}`, worst, bad);
}

/** mulberry32: a small seeded generator, so the sample is the same everywhere. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** n cases chosen by a seeded partial shuffle, kept in fixture order. */
function sample<T>(cases: T[], n: number): T[] {
  if (n >= cases.length) return cases;
  const next = rng(SAMPLE_SEED);
  const idx = cases.map((_, i) => i);
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(next() * (idx.length - i));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx.slice(0, n).sort((a, b) => a - b).map((i) => cases[i]);
}

function runFixtures(file: string, fn: (s: any) => unknown) {
  const fx = readFixture(file);
  assert.equal(fx.contractVersion, ENGINE_CONTRACT_VERSION);
  assert.equal(fx.modelVersion, modelVersion());
  const cases = FULL ? fx.cases : sample(fx.cases, SAMPLE_SIZE[file]);
  const worst = new Map<string, number>();
  const bad: string[] = [];
  const t0 = performance.now();
  for (const c of cases) compare(c.expected, fn(c.situation), `[${c.name}]`, worst, bad);
  const ms = (performance.now() - t0) / cases.length;
  const top = [...worst.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  console.log(`${file}: ${cases.length} of ${fx.cases.length} cases, ${ms.toFixed(1)} ms each, largest diffs ${top.map(([k, v]) => `${k} ${v.toExponential(1)}`).join(', ')}`);
  assert.deepEqual(bad.slice(0, 20), [], `${bad.length} mismatches`);
}

test('model loads', () => {
  assert.equal(loadModel(files(), ENGINE_CONTRACT_VERSION), true);
  assert.equal(isModelLoaded(), true);
});

test(`recommend() matches Python on ${FULL ? 'every' : 'a sample of'} 4th down fixture${FULL ? '' : 's'}`, () => {
  loadModel(files(), ENGINE_CONTRACT_VERSION);
  runFixtures('fourth_down.json', recommend);
});

test(`recommendTry() matches Python on ${FULL ? 'every' : 'a sample of'} try fixture${FULL ? '' : 's'}`, () => {
  loadModel(files(), ENGINE_CONTRACT_VERSION);
  runFixtures('try.json', recommendTry);
});

test('unavailable, never a throw, when the model is not loaded or does not match', () => {
  const situation = readFixture('fourth_down.json').cases[0].situation;
  const unavailable = { supported: false, reason: 'unavailable' };

  unloadModel();
  assert.deepEqual(recommend(situation), unavailable);
  assert.deepEqual(recommendTry(situation), unavailable);

  // Site built against another contract version.
  assert.equal(loadModel(files(), ENGINE_CONTRACT_VERSION + 1), false);
  assert.deepEqual(recommend(situation), unavailable);

  // Files from different exports.
  const mixed = files();
  mixed.tables = { ...mixed.tables, modelVersion: 'other' };
  assert.equal(loadModel(mixed, ENGINE_CONTRACT_VERSION), false);

  // Correction terms this engine does not implement.
  const withTerms = files();
  withTerms.terms = { ...withTerms.terms, fourthDown: [{}] };
  assert.equal(loadModel(withTerms, ENGINE_CONTRACT_VERSION), false);

  // A missing or corrupt file.
  const broken = files() as any;
  broken.fdModel = { ...broken.fdModel, treeSizes: [1] };
  assert.equal(loadModel(broken, ENGINE_CONTRACT_VERSION), false);
  assert.equal(loadModel({ manifest: null } as any, ENGINE_CONTRACT_VERSION), false);
  assert.deepEqual(recommend(situation), unavailable);

  // Garbage input with a model loaded.
  loadModel(files(), ENGINE_CONTRACT_VERSION);
  assert.deepEqual(recommend(null as any), unavailable);
  assert.deepEqual(recommend({ ...situation, secondsRemaining: 'x' }), unavailable);
});
