import assert from 'node:assert/strict';
import { test } from 'node:test';

import { normalize, search, type SearchEntry } from '../src/lib/search/match.ts';

const player = (label: string, team: string, weight: number): SearchEntry => ({
  kind: 'player',
  label,
  detail: `QB, ${team}`,
  href: `/p/${label}`,
  terms: team,
  weight,
});

const entries: SearchEntry[] = [
  player('Josh Allen', 'BUF', 9),
  player('Josh Allen', 'JAX', 3),
  player('Kyle Allen', 'BUF', 3),
  player('Allen Lazard', 'NYJ', 4),
  player('Amon-Ra St. Brown', 'DET', 9),
  player('Audric Estimé', 'DEN', 4),
  { kind: 'team', label: 'Buffalo Bills', detail: 'Team', href: '/t/BUF', terms: 'BUF Bills', weight: 0 },
  { kind: 'page', label: 'Passing leaderboard', detail: 'Stats', href: '/s/passing', terms: 'passing stats', weight: 0 },
];

const labels = (typed: string) => search(entries, typed).map((e) => `${e.label} ${e.terms}`);

test('normalizing drops accents and punctuation', () => {
  assert.equal(normalize('Amon-Ra St. Brown'), 'amon ra st brown');
  assert.equal(normalize('Audric Estimé'), 'audric estime');
  assert.equal(normalize("  D'Andre  "), 'dandre');
});

test('an exact name wins, then stronger players break ties', () => {
  assert.deepEqual(labels('josh allen'), ['Josh Allen BUF', 'Josh Allen JAX']);
});

test('a last name finds every match, names starting with it first', () => {
  assert.deepEqual(labels('allen'), ['Allen Lazard NYJ', 'Josh Allen BUF', 'Josh Allen JAX', 'Kyle Allen BUF']);
});

test('every word has to match the start of a word', () => {
  assert.deepEqual(labels('j allen'), ['Josh Allen BUF', 'Josh Allen JAX']);
  assert.deepEqual(labels('llen'), []);
});

test('a team abbreviation narrows players and finds the team first', () => {
  assert.deepEqual(labels('allen buf'), ['Josh Allen BUF', 'Kyle Allen BUF']);
  assert.equal(search(entries, 'bills')[0]!.label, 'Buffalo Bills');
});

test('accents, hyphens and periods are optional when typing', () => {
  assert.equal(search(entries, 'estime')[0]!.label, 'Audric Estimé');
  assert.equal(search(entries, 'amon ra st')[0]!.label, 'Amon-Ra St. Brown');
});

test('pages are found by title', () => {
  assert.equal(search(entries, 'passing')[0]!.label, 'Passing leaderboard');
});

test('blank queries return nothing and results are capped', () => {
  assert.deepEqual(search(entries, '   '), []);
  assert.equal(search(entries, 'a', 3).length, 3);
});
