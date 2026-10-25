import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { loadFourthDownModel, recommend, type ModelFiles } from '../src/lib/fourth-down.ts';
import { startedToday } from '../src/lib/live-fourth/feed.ts';
import { didWords, gradeOf, situationFromSummary, situationWords, teamCallOf } from '../src/lib/live-fourth/grade.ts';
import { parseSummary } from '../src/lib/live-fourth/summary.ts';

const ESPN = join(import.meta.dirname, 'fixtures', 'espn');
const read = (f: string) => JSON.parse(readFileSync(join(ESPN, f), 'utf8'));
const chi = { season: 2026, away: 'NE', home: 'CHI', spreadLine: 3, totalLine: 50.5, roof: 'outdoors' as const };

test("every 4th down snap in Thursday's summary, including the eight the capture saw", () => {
  const game = parseSummary(read('summary-401873010-final-plays.json'), '401873010')!;
  assert.deepEqual([game.homeId, game.awayId], ['3', '17']);
  assert.equal(game.fourthDowns.length, 13);
  const capture = read('live-fourth-401873010.json');
  const ids = new Set(game.fourthDowns.map((d) => d.id));
  for (const e of capture.expectedFourthDowns) assert.ok(ids.has(e.id), `missing ${e.id}`);
  // Timeouts and other stoppages carry down 4 too; none is listed.
  assert.ok(game.fourthDowns.every((d) => !/timeout|penalty/i.test(d.type)));
});

test('field position from yardLine and the team with the ball; the score before the snap', () => {
  const game = parseSummary(read('summary-401873010-final-plays.json'), '401873010')!;
  // CHI's punt from its own 24: 76 yards from NE's goal line (ESPN's yardsToEndzone says 24).
  const punt = game.fourthDowns.find((d) => d.id === '401873010605')!;
  assert.deepEqual([punt.teamId, punt.yardline100, punt.distance], ['3', 76, 7]);
  // CHI's 4th and 2 at Q4 9:40, CHI up 27 to 21 before the snap.
  const go = game.fourthDowns.find((d) => d.id === '4018730103386')!;
  assert.deepEqual([go.yardline100, go.homeScore, go.awayScore], [43, 27, 21]);
  assert.equal(situationWords(go, game.homeId, chi), 'CHI 4th and 2 at NE 43, up 6');
  assert.equal(didWords(go), 'Went for it');
});

test('a play repeated in the current drive is listed once', () => {
  const game = parseSummary(read('summary-401873011-q3-plays.json'), '401873011')!;
  assert.equal(game.fourthDowns.length, 8);
  assert.equal(new Set(game.fourthDowns.map((d) => d.id)).size, 8);
  const td = game.fourthDowns.find((d) => d.type === 'Passing Touchdown')!;
  assert.deepEqual([td.yardline100, td.distance], [1, 1]);
});

test('preliminary grades: cost, questionable and clear, null options, unsupported', () => {
  const dir = join(import.meta.dirname, '..', 'models', 'fourth-down');
  const r = (f: string) => JSON.parse(readFileSync(join(dir, f), 'utf8'));
  const files: ModelFiles = {
    manifest: r('manifest.json'), fdModel: r('fd_model.json'), epModel: r('ep_model.json'),
    homeWpModel: r('home_wp_model.json'), wpSpreadModel: r('wp_spread_model.json'),
    twoPtModel: r('two_pt_model.json'), tables: r('tables.json'), terms: r('terms.json'),
  };
  assert.equal(loadFourthDownModel(files), true);
  const game = parseSummary(read('summary-401873010-final-plays.json'), '401873010')!;
  for (const d of game.fourthDowns) {
    const situation = situationFromSummary(d, game.homeId, chi, null)!;
    // No scoreboard timeouts given: counted from the summary.
    assert.equal(situation.timeoutsOffense, d.teamId === game.homeId ? d.homeTimeouts : d.awayTimeouts);
    const grade = gradeOf(recommend(situation), teamCallOf(d).call);
    assert.equal(grade.kind, 'graded');
    if (grade.kind !== 'graded') continue;
    if (grade.wpLost !== null) assert.ok(grade.wpLost >= 0);
    assert.equal(grade.questionable, !grade.decided && (grade.wpLost ?? 0) >= 0.02);
    if (grade.clear) assert.ok(grade.questionable);
  }
  const fake = { supported: true, call: 'go', wpGo: 0.5, wpPunt: 0.44, wpFieldGoal: null } as const;
  const g = gradeOf({ ...fake, conversionProb: 0.5, fgMakeProb: null, kickDistance: 70, kickerId: null, flags: { temperatureUnknown: false, kickerUnknown: false, linesUnknown: false }, breakdown: {} as never }, 'punt');
  assert.ok(g.kind === 'graded' && Math.abs(g.wpLost! - 0.06) < 1e-9 && g.questionable && g.clear);
  const fg = gradeOf({ ...fake, conversionProb: 0.5, fgMakeProb: null, kickDistance: 70, kickerId: null, flags: { temperatureUnknown: false, kickerUnknown: false, linesUnknown: false }, breakdown: {} as never }, 'field goal');
  assert.ok(fg.kind === 'graded' && fg.wpLost === null && !fg.questionable);
  assert.deepEqual(gradeOf({ supported: false, reason: 'overtime' }, 'go'), { kind: 'unsupported', message: "Not graded: nfl4th doesn't compute overtime." });
});

test("today's games: kicked off and on today's Eastern date", () => {
  const games = {
    a: { ...chi, kickoff: '2026-10-25T13:30:00Z' },
    b: { ...chi, kickoff: '2026-10-25T17:00:00Z' },
    c: { ...chi, kickoff: '2026-10-26T00:20:00Z' },
    d: { ...chi, kickoff: '2026-10-23T00:15:00Z' },
  };
  assert.deepEqual(startedToday(games, new Date('2026-10-25T18:00:00Z')), ['a', 'b']);
  // 8:20 PM Eastern is still Sunday the 25th.
  assert.deepEqual(startedToday(games, new Date('2026-10-26T01:00:00Z')), ['a', 'b', 'c']);
});

test("timeouts counted from the summary match the scoreboard at Thursday's eight captured 4th downs", async () => {
  const { stepAll } = await import('../src/lib/live-fourth/tracker.ts');
  const capture = read('live-fourth-401873010.json');
  let tracks = new Map();
  const scoreboard = new Map<string, [number, number]>();
  for (const s of capture.snapshots) {
    tracks = stepAll(tracks, [s]);
    const d = tracks.get(s.event)?.current;
    if (d?.outcome.kind === 'played') scoreboard.set(d.outcome.play.id, [d.before.homeTimeouts, d.before.awayTimeouts]);
  }
  const game = parseSummary(read('summary-401873010-final-plays.json'), '401873010')!;
  let compared = 0;
  for (const d of game.fourthDowns) {
    const sb = scoreboard.get(d.id);
    if (!sb) continue;
    assert.deepEqual([d.homeTimeouts, d.awayTimeouts], sb, `${d.period} ${d.clock}`);
    compared += 1;
  }
  assert.equal(compared, 8);
  // And a game in progress: PIT's second timeout of the first half, before NO's 4th and goal.
  const pitno = parseSummary(read('summary-401873011-q3-plays.json'), '401873011')!;
  const goal = pitno.fourthDowns.find((d) => d.type === 'Passing Touchdown')!;
  assert.equal(goal.awayTimeouts, 1);
});

test('a 4th down nullified by a penalty after the snap is listed, a pre-snap foul is not', async () => {
  const { nullifyingFoul } = await import('../src/lib/live-fourth/summary.ts');
  const game = parseSummary(read('summary-401873011-final-plays.json'), '401873011')!;
  assert.equal(game.final, true);
  const nullified = game.fourthDowns.filter((d) => d.nullified);
  assert.equal(nullified.length, 1);
  assert.equal(nullified[0].nullified, 'Defensive Offside');
  assert.deepEqual([nullified[0].period, nullified[0].clock, nullified[0].distance, nullified[0].yardline100], [4, '1:04', 3, 19]);
  // The 11 snaps that stood (as the live page showed them) plus the nullified field goal.
  assert.equal(game.fourthDowns.length, 12);
  // NE's false start before its 4th down punt on Thursday is a pre-snap foul.
  assert.equal(nullifyingFoul('(Shotgun) PENALTY on NE-M.Pryor, False Start, 5 yards, enforced at NE 48 - No Play.'), null);
  assert.equal(nullifyingFoul('(3:21) (Run formation) 79-L.Borom reported in as eligible. PENALTY on DET, Delay of Game, 5 yards - No Play.'), null);
  const thursday = parseSummary(read('summary-401873010-final-plays.json'), '401873010')!;
  assert.ok(thursday.fourthDowns.every((d) => !/False Start/.test(d.text)));
});
