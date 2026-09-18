import assert from 'node:assert/strict';
import { test } from 'node:test';

import { playerSlug } from '../src/utils/slug.ts';
import { formatExperience, formatHeight } from '../src/utils/format.ts';

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
