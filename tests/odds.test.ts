import assert from 'node:assert/strict';
import { test } from 'node:test';

import { formatChance } from '../src/lib/teams/odds.ts';
import { formatWeeks, oddsBasis, playoffBasis, splitWeeks, type BasisGame } from '../src/lib/odds/basis.ts';

test('chances never claim a team is certainly in or out', () => {
  assert.equal(formatChance(0), '<1%');
  assert.equal(formatChance(0.004), '<1%');
  assert.equal(formatChance(0.005), '1%');
  assert.equal(formatChance(0.68), '68%');
  assert.equal(formatChance(0.994), '99%');
  assert.equal(formatChance(0.995), '>99%');
  assert.equal(formatChance(1), '>99%');
});

function game(week: number, priced: boolean, played = false, type = 'REG'): BasisGame {
  return {
    week,
    type,
    homeScore: played ? 20 : null,
    awayScore: played ? 17 : null,
    homeMoneyline: priced ? -150 : null,
    awayMoneyline: priced ? 130 : null,
  };
}

test('weeks are written as runs', () => {
  assert.equal(formatWeeks([9]), 'week 9');
  assert.equal(formatWeeks([8, 7]), 'weeks 7 and 8');
  assert.equal(formatWeeks([9, 10, 11, 12, 13, 14, 15, 16, 17, 18]), 'weeks 9 to 18');
  assert.equal(formatWeeks([7, 8, 10, 11, 12]), 'weeks 7, 8 and 10 to 12');
});

test('only unplayed regular season games count, played ones keep their closing line', () => {
  const games = [game(6, true, true), game(7, true), game(8, true), game(9, false), game(18, false), game(19, false, false, 'WC')];
  assert.deepEqual(splitWeeks(games), { pricedWeeks: [7, 8], ratedWeeks: [9, 18] });
});

test('the label names the weeks with lines and the weeks priced from the ratings', () => {
  const games = [game(7, true), game(8, true), ...[9, 10, 11, 12, 13, 14, 15, 16, 17, 18].map((w) => game(w, false))];
  const basis = oddsBasis(games);
  assert.equal(
    basis.long,
    'Based on betting lines for weeks 7 and 8. Games without a line yet (weeks 9 to 18) are priced from ' +
      'team ratings derived from betting lines.',
  );
  assert.equal(basis.short, 'betting lines and market ratings');
});

test('the ends of the season', () => {
  assert.match(oddsBasis([game(1, false), game(2, false)]).long, /every game is priced from team ratings derived from betting lines/);
  assert.equal(oddsBasis([game(18, true)]).long, 'Based on betting lines for every remaining game.');
  assert.equal(oddsBasis([game(18, true, true)]).long, 'The regular season is over.');
});

test('the draft projection says how it plays the playoffs', () => {
  assert.match(playoffBasis(0), /priced from the same team ratings/);
  assert.match(playoffBasis(2), /betting line where they have one and team ratings derived from betting lines otherwise/);
  for (const n of [0, 2]) assert.match(playoffBasis(n), /no home field in the Super Bowl/);
});
