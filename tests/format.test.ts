import assert from 'node:assert/strict';
import { test } from 'node:test';

import { playerSlug } from '../src/utils/slug.ts';
import { formatExperience, formatHeight, formatStat } from '../src/utils/format.ts';

test('periods and apostrophes vanish rather than splitting the name', () => {
  assert.equal(playerSlug('C.J. Stroud'), 'cj-stroud');
  assert.equal(playerSlug("Ja'Marr Chase"), 'jamarr-chase');
  assert.equal(playerSlug('Amon-Ra St. Brown'), 'amon-ra-st-brown');
  assert.equal(playerSlug('Marvin Harrison Jr.'), 'marvin-harrison-jr');
});

test('accents are dropped so URLs stay plain ASCII', () => {
  assert.equal(playerSlug('Audric Estimé'), 'audric-estime');
});

test('plain names are unchanged apart from case', () => {
  assert.equal(playerSlug('Puka Nacua'), 'puka-nacua');
});

test('height reads as feet and inches', () => {
  assert.equal(formatHeight(74), '6-2');
  assert.equal(formatHeight(72), '6-0');
  assert.equal(formatHeight(null), null);
});

test('a rookie season reads as R', () => {
  assert.equal(formatExperience(0), 'R');
  assert.equal(formatExperience(9), '9');
  assert.equal(formatExperience(null), null);
});

test('stat values format by type', () => {
  // Pipelines store exactly three decimals, which format without drift.
  assert.equal(formatStat(0.155, 'signed3'), '+0.155');
  assert.equal(formatStat(0.105, 'signed3'), '+0.105');
  assert.equal(formatStat(-0.041, 'signed3'), '\u22120.041');
  assert.equal(formatStat(0, 'signed3'), '0.000');
  assert.equal(formatStat(0.498, 'percent1'), '49.8%');
  assert.equal(formatStat(0.575, 'percent1'), '57.5%');
  assert.equal(formatStat(null, 'percent1'), '-');
});
