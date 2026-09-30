import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  gamesLabel,
  logWeekLabel,
  recapEmpty,
  seasonLabel,
  statusLine,
  throughLabel,
  weekProgress,
  type AsOfContext,
} from '../src/lib/as-of/labels.ts';

/** A 2026 schedule of 16 games a week, with `final[w]` games of week w final. */
function season(final: Record<number, number>, weeks = 18): AsOfContext {
  const games = [];
  for (let week = 1; week <= weeks; week++) {
    for (let i = 0; i < 16; i++) games.push({ week, final: i < (final[week] ?? 0) });
  }
  return { season: 2026, games };
}

// The four moments in tests/fixtures/states/states.json.
const sunday = season({ 1: 16, 2: 1 }); // week 2, 2:30 PM: only Thursday's game final
const tuesday = season({ 1: 16, 2: 16, 3: 16 }); // week 3 over, Monday night included
const wednesday = season({ 1: 16, 2: 16 }); // the ticker on week 3, nothing played
const offseason = season({}); // June: 2026 not started, the files still 2025's

describe('Sunday during games', () => {
  const week2 = weekProgress(sunday, 2026, 2);

  test('a partly played week is in progress, not "through week 2"', () => {
    assert.deepEqual(week2, { kind: 'in-progress', season: 2026, week: 2, played: 1, total: 16 });
    assert.equal(throughLabel(week2), 'Week 2 in progress: 1 of 16 games played.');
    assert.equal(seasonLabel(week2), '2026 regular season, week 2 in progress: 1 of 16 games played.');
  });

  test('team stats count games per team', () => {
    assert.equal(gamesLabel(sunday, 2026, 1, 2, true), 'Through 1 to 2 games per team.');
    assert.equal(gamesLabel(sunday, 2026, 2, 2), 'Through 2 games.');
    assert.equal(gamesLabel(sunday, 2026, 1, 1), 'Through 1 game.');
  });

  test('game statuses still matter while games are left', () => {
    assert.equal(statusLine(sunday, 2, '2 out, 1 doubtful'), 'Game statuses for week 2 games still to play: 2 out, 1 doubtful.');
    assert.equal(statusLine(sunday, 2, null), 'Game statuses for week 2 games still to play: none filed yet.');
  });

  test("the logs' week says how much of it is in", () => {
    assert.deepEqual(logWeekLabel(sunday, 2026, 2), {
      name: 'Week 2',
      note: 'Week 2 in progress: 1 of 16 games played. The rest land as games finish.',
    });
  });

  test('the recap page waits for a complete week once the season has started', () => {
    assert.equal(recapEmpty(sunday).title, 'No complete week yet');
  });
});

describe('Tuesday after every game is final', () => {
  test('a finished week is "through week 3"', () => {
    const p = weekProgress(tuesday, 2026, 3);
    assert.equal(throughLabel(p), 'Through week 3.');
    assert.equal(seasonLabel(p), '2026 regular season, through week 3.');
  });

  test('no leftover game statuses once every game is final', () => {
    assert.equal(statusLine(tuesday, 3, null), null);
    assert.equal(statusLine(tuesday, 3, '1 out'), null);
  });

  test('a complete week has no progress note', () => {
    assert.deepEqual(logWeekLabel(tuesday, 2026, 3), { name: 'Week 3', note: null });
  });
});

describe('Wednesday looking ahead', () => {
  test('the files are through the last complete week', () => {
    assert.equal(throughLabel(weekProgress(wednesday, 2026, 2)), 'Through week 2.');
  });

  test("statuses are for the coming week's games", () => {
    assert.equal(statusLine(wednesday, 3, null), 'Game statuses for week 3 games still to play: none filed yet.');
    assert.equal(statusLine(wednesday, 3, '3 questionable'), 'Game statuses for week 3 games still to play: 3 questionable.');
  });
});

describe('Offseason', () => {
  test('files from the finished season name it and say it is final', () => {
    const p = weekProgress(offseason, 2025, 18);
    assert.deepEqual(p, { kind: 'prior-season', season: 2025 });
    assert.equal(throughLabel(p), '2025 regular season, final.');
    assert.equal(seasonLabel(p), '2025 regular season, final.');
    assert.equal(gamesLabel(offseason, 2025, 17, 17, true), '2025 regular season, final.');
  });

  test("the logs' week names its season", () => {
    assert.deepEqual(logWeekLabel(offseason, 2025, 18), { name: '2025 week 18', note: null });
  });

  test('no game statuses', () => {
    assert.equal(statusLine(offseason, null, null), null);
  });

  test('the recap page says the season has not started, not that nothing was played', () => {
    const empty = recapEmpty(offseason);
    assert.equal(empty.title, 'The 2026 season has not started');
    assert.doesNotMatch(empty.text, /No complete week/);
  });

  test('a new season before its first game', () => {
    const p = weekProgress(offseason, 2026, 0);
    assert.equal(throughLabel(p), 'No games played yet.');
    assert.equal(seasonLabel(p), '2026 regular season, before the first game.');
    assert.equal(gamesLabel(offseason, 2026, 0, 0), 'No games played yet.');
  });
});
