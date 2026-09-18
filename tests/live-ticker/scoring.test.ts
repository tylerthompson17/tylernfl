import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  abbreviateNames,
  describeLastScore,
  matchesScore,
  parseLastScore,
  shortPlayText,
  summaryUrl,
} from '../../src/lib/live-ticker/scoring.ts';

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`../fixtures/espn/${name}`, import.meta.url), 'utf8'));

test('the live DET at BUF summary gives the latest touchdown', () => {
  const last = parseLastScore(fixture('summary-401872932-q1.json'));
  assert.deepEqual(last, {
    side: 'home',
    kind: 'TD',
    text: 'Joshua Palmer 43 Yd pass from Josh Allen (Tyler Bass Kick)',
    period: 1,
    clock: '3:42',
    awayScore: 0,
    homeScore: 14,
  });
});

test('a defensive touchdown belongs to the defense', () => {
  const data = fixture('summary-401872658-final.json');
  const pickSix = data.scoringPlays.findIndex((p: { text: string }) => p.text.startsWith('T.J. Watt'));
  data.scoringPlays = data.scoringPlays.slice(0, pickSix + 1);
  const last = parseLastScore(data)!;
  assert.equal(last.side, 'home');
  assert.equal(last.kind, 'TD');
});

test('overtime and a failed two point try are read as given', () => {
  const last = parseLastScore(fixture('summary-401872923-final-ot.json'))!;
  assert.equal(last.period, 5);
  assert.equal(last.side, 'away');
  assert.equal(describeLastScore(last, 'NO').title.startsWith('OT 1:34, NO: '), true);
});

test('without the header, the side comes from whose score went up', () => {
  const data = fixture('summary-401872932-q1.json');
  delete data.header;
  assert.equal(parseLastScore(data)!.side, 'home');
});

test('no scoring plays, or an unexpected shape, gives no line', () => {
  assert.equal(parseLastScore({ scoringPlays: [] }), null);
  assert.equal(parseLastScore({}), null);
  assert.equal(parseLastScore(null), null);
  assert.equal(parseLastScore({ scoringPlays: [{ text: 'x', awayScore: '7' }] }), null);
});

test('the line matches only once the summary has caught up with the ticker', () => {
  const last = parseLastScore(fixture('summary-401872932-q1.json'))!;
  assert.equal(matchesScore(last, 0, 14), true);
  // Scoreboard already shows the extra point that the summary lacks.
  assert.equal(matchesScore(last, 0, 15), false);
});

test('the visible line drops the conversion; the tooltip keeps everything', () => {
  assert.equal(shortPlayText('Josh Allen 1 Yd Rush (Tyler Bass Kick)'), 'Josh Allen 1 Yd Rush');
  assert.equal(shortPlayText('Andy Borregales 50 Yd Field Goal '), 'Andy Borregales 50 Yd Field Goal');
  // Seen in week 1: a period after the parenthetical.
  assert.equal(
    shortPlayText('Brenton Strange 5 Yd pass from Deshaun Watson (Andre Szmyt Kick).'),
    'Brenton Strange 5 Yd pass from Deshaun Watson'
  );
  const last = parseLastScore(fixture('summary-401872932-q1.json'))!;
  assert.deepEqual(describeLastScore(last, 'BUF'), {
    line: 'BUF TD: J.Palmer 43 Yd pass from J.Allen',
    title: 'Q1 3:42, BUF: Joshua Palmer 43 Yd pass from Josh Allen (Tyler Bass Kick)',
  });
});

test('summary requests are plain GETs keyed by event id', () => {
  assert.equal(
    summaryUrl('401872932'),
    'https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=401872932'
  );
});

test('first names become initials, ESPN style', () => {
  // Every name shape in week 1's 142 scoring plays.
  const cases: [string, string][] = [
    ['Josh Allen 1 Yd Rush', 'J.Allen 1 Yd Rush'],
    ['Andy Borregales 50 Yd Field Goal', 'A.Borregales 50 Yd Field Goal'],
    ['Amon-Ra St. Brown 12 Yd pass from Jared Goff', 'A.St. Brown 12 Yd pass from J.Goff'],
    ['Nico Collins 20 Yd pass from C.J. Stroud', 'N.Collins 20 Yd pass from C.J. Stroud'],
    ['T.J. Watt 35 Yd Interception Return', 'T.J. Watt 35 Yd Interception Return'],
    ["D'Andre Swift 3 Yd Rush", 'D.Swift 3 Yd Rush'],
    ["Ka'imi Fairbairn 44 Yd Field Goal", 'K.Fairbairn 44 Yd Field Goal'],
    ['Kenneth Walker III 7 Yd Rush', 'K.Walker III 7 Yd Rush'],
    ['Demetrius Knight Jr. 27 Yd Fumble Return', 'D.Knight Jr. 27 Yd Fumble Return'],
    ['Jaxon Smith-Njigba 9 Yd pass from Sam Darnold', 'J.Smith-Njigba 9 Yd pass from S.Darnold'],
  ];
  for (const [text, expected] of cases) assert.equal(abbreviateNames(text), expected);
});

test('text in an unexpected shape is left as ESPN wrote it', () => {
  assert.equal(abbreviateNames('Team Safety'), 'Team Safety');
  assert.equal(abbreviateNames('Two-Point Conversion'), 'Two-Point Conversion');
});
