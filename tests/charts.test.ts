import assert from 'node:assert/strict';
import { test } from 'node:test';

import { chartProblems, labelSvg, reservedSlug, resolveLogos, tagSlug, type ChartCheck } from '../src/lib/charts/collection.ts';

const entry = (slug: string, overrides: Partial<ChartCheck> = {}): ChartCheck => ({
  slug,
  featured: false,
  draft: false,
  script: `${slug.replace(/-/g, '_')}.py`,
  ...overrides,
});

test('a complete collection has no problems', () => {
  const entries = [entry('epa-tiers', { featured: true }), entry('qb-aggression')];
  assert.deepEqual(
    chartProblems(entries, new Set(['epa-tiers', 'qb-aggression']), new Set(['epa_tiers.py', 'qb_aggression.py'])),
    []
  );
});

test('an entry without its SVG or script is named, with what to do', () => {
  const problems = chartProblems([entry('epa-tiers')], new Set(), new Set());
  assert.equal(problems.length, 2);
  assert.match(problems[0]!, /epa-tiers\.md has no epa-tiers\.svg.*Run its script/);
  assert.match(problems[1]!, /epa_tiers\.py, which is not in pipelines\/charts\/mine/);
});

test('two featured charts fail, but a featured draft does not count', () => {
  const svgs = new Set(['a', 'b', 'c']);
  const scripts = new Set(['a.py', 'b.py', 'c.py']);
  const twoFeatured = [entry('a', { featured: true }), entry('b', { featured: true })];
  assert.match(chartProblems(twoFeatured, svgs, scripts)[0]!, /Only one chart can be featured; these all are: a, b/);

  const oneIsDraft = [entry('a', { featured: true }), entry('c', { featured: true, draft: true })];
  assert.deepEqual(chartProblems(oneIsDraft, svgs, scripts), []);
});

test('page numbers and "tag" are not chart names', () => {
  assert.equal(reservedSlug('2'), true);
  assert.equal(reservedSlug('tag'), true);
  assert.equal(reservedSlug('team'), true);
  assert.equal(reservedSlug('week-2'), false);
  assert.match(chartProblems([entry('3')], new Set(['3']), new Set(['3.py']))[0]!, /"3" cannot be a chart name/);
});

test('tags become URL parts', () => {
  assert.equal(tagSlug('EPA'), 'epa');
  assert.equal(tagSlug('4th down'), '4th-down');
  assert.equal(tagSlug('  Run/pass split '), 'run-pass-split');
  assert.equal(tagSlug('Défense'), 'defense');
});

test('logo references point at the site copy, under the base path', () => {
  const svg = '<image xlink:href="logo:BUF" x="1"/><image xlink:href="logo:KC" x="2"/>';
  assert.equal(
    resolveLogos(svg, (team) => `/tylernfl/logos/${team}.png`, new Set(['BUF', 'KC'])),
    '<image xlink:href="/tylernfl/logos/BUF.png" x="1"/><image xlink:href="/tylernfl/logos/KC.png" x="2"/>'
  );
});

test('a logo for a team that does not exist fails rather than leaving a gap', () => {
  assert.throws(() => resolveLogos('<image href="logo:OAK"/>', (t) => t, new Set(['LV'])), /logo for OAK/);
});

test('embedded pictures and other links are left alone', () => {
  const svg = '<image xlink:href="data:image/png;base64,AAAA"/><a href="#top">x</a>';
  assert.equal(resolveLogos(svg, (t) => t, new Set()), svg);
});

test('the chart is one image named by its title and described by its note', () => {
  assert.equal(
    labelSvg('<svg class="chart-svg" viewBox="0 0 720 405"><g/></svg>', 't', 'n'),
    '<svg role="img" aria-labelledby="t" aria-describedby="n" focusable="false" class="chart-svg" viewBox="0 0 720 405"><g/></svg>'
  );
});

test("a chart of Tyler's cannot take a kept auto chart's name", () => {
  const slug = 'auto-2026-week-2-ind-at-kc-win-probability';
  const problems = chartProblems([entry(slug)], new Set([slug]), new Set([`${slug.replace(/-/g, '_')}.py`]), new Set([slug]));
  assert.equal(problems.length, 1);
  assert.match(problems[0]!, /a kept auto chart already has it/);
});
