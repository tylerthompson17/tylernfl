import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { loadFourthDownModel, recommend, type ModelFiles } from '../src/lib/fourth-down.ts';
import { liveWords, optionRows, situationOf, type LiveGameInfo } from '../src/lib/live-fourth/situation.ts';
import { parseSnapshots, yardline100, type Snapshot } from '../src/lib/live-fourth/snapshot.ts';
import { callOf, stepAll, type GameTrack, type LiveFourthDown } from '../src/lib/live-fourth/tracker.ts';
import { punterLine } from '../src/lib/live-fourth/words.ts';

const ESPN = join(import.meta.dirname, 'fixtures', 'espn');
const fixture = JSON.parse(readFileSync(join(ESPN, 'live-fourth-401873010.json'), 'utf8'));
const snapshots: Snapshot[] = fixture.snapshots;
const HOME = fixture.teams.home.id;
const game: LiveGameInfo = { season: 2026, away: 'NE', home: 'CHI', spreadLine: 1.5, totalLine: 50.5, roof: 'outdoors' };

/** Every 4th down the tracker found, polled one snapshot at a time, in order. */
function run(polls: Snapshot[]): { found: LiveFourthDown[]; history: LiveFourthDown[] } {
  let tracks = new Map<string, GameTrack>();
  const byStart = new Map<string, LiveFourthDown>();
  const history: LiveFourthDown[] = [];
  for (const s of polls) {
    tracks = stepAll(tracks, [s]);
    const current = tracks.get(s.event)?.current;
    if (current) {
      byStart.set(current.firstSeen, current);
      history.push(current);
    }
  }
  return { found: [...byStart.values()], history };
}

test('field position from yardLine and possession, never yardsToEndzone', () => {
  // CHI is home: its own 24 is 76 yards from NE's goal line. ESPN said 24.
  const [first, second] = fixture.chiPunts;
  assert.equal(first.start.team.id, HOME);
  assert.equal(first.start.yardsToEndzone, 24);
  assert.equal(yardline100(first.start.yardLine, first.start.team.id, HOME), 76);
  assert.equal(second.start.yardsToEndzone, 28);
  assert.equal(yardline100(second.start.yardLine, second.start.team.id, HOME), 72);
  // NE is the visitor: yardLine already counts toward CHI's goal line.
  assert.equal(yardline100(57, '17', HOME), 57);
  assert.equal(yardline100(57, null, HOME), null);
});

test('a raw scoreboard event as a snapshot (DET at BUF capture)', () => {
  const data = JSON.parse(readFileSync(join(ESPN, 'scoreboard-2026-week2-in-progress.json'), 'utf8'));
  const live = parseSnapshots(data, '2026-09-18T01:20:49Z').filter((s) => s.state === 'in');
  assert.equal(live.length, 1);
  const s = live[0];
  assert.deepEqual([s.down, s.distance, s.yardLine, s.possession, s.homeTimeouts, s.awayTimeouts], [2, 13, 84, '2', 3, 3]);
  // "2nd & 13 at DET 16" with BUF (home) on offense.
  assert.equal(yardline100(s.yardLine, s.possession, s.homeId), 16);
  assert.equal(s.lastPlay?.type, 'Penalty');
  assert.deepEqual(s.lastPlay?.start, { yardLine: 94, team: '2' });
});

test("all eight of tonight's 4th downs, each answered by its own play", () => {
  const { found } = run(snapshots);
  const expected = fixture.expectedFourthDowns as { id: string; type: string }[];
  assert.equal(expected.length, 8);
  assert.deepEqual(
    found.map((d) => (d.outcome.kind === 'played' ? d.outcome.play.id : d.outcome.kind)),
    expected.map((e) => e.id),
  );
  const calls = found.map((d) => (d.outcome.kind === 'played' ? d.outcome.call : null));
  assert.deepEqual(calls, ['go', 'field goal', 'punt', 'punt', 'go', 'field goal', 'punt', 'field goal']);
});

test('pending through a timeout, a false start and the end of a quarter', () => {
  const { history } = run(snapshots);
  const forPlay = (id: string) =>
    history.filter((d) => d.outcome.kind === 'pending' && history.some((h) => h.firstSeen === d.firstSeen && h.outcome.kind === 'played' && h.outcome.play.id === id));

  // CHI's 4th and 2 at Q4 9:40: its own timeout came first, and the
  // situation picked up the timeout (3 to 2) while still pending.
  const timeout = forPlay('4018730103386');
  assert.ok(timeout.some((d) => d.before.lastPlay?.type === 'Timeout'));
  assert.equal(timeout.at(-1)!.before.homeTimeouts, 2);

  // NE's punt: 4th and 2 at the end of the 3rd quarter, still pending at
  // Q4 15:00, then a false start made it 4th and 7.
  const punt = forPlay('4018730103135');
  assert.deepEqual([punt[0].before.period, punt[0].before.distance], [3, 2]);
  assert.ok(punt.some((d) => d.before.lastPlay?.type === 'End Period'));
  assert.ok(punt.some((d) => d.before.lastPlay?.type === 'Penalty' && d.before.distance === 7));
  assert.equal(punt.at(-1)!.before.distance, 7);
});

test('outcome not seen when the scoreboard skips the play, with nothing inferred', () => {
  // Drop every poll that showed NE's 6:28 punt: the next play ESPN reports
  // starts elsewhere, so the 4th down is not seen, not called a punt.
  const skipped = snapshots.filter((s) => s.lastPlay?.id !== '4018730103592');
  const { found } = run(skipped);
  const missed = found.find((d) => d.before.period === 4 && d.before.clock.startsWith('6:'))!;
  assert.equal(missed.outcome.kind, 'not seen');
  assert.ok(missed.outcome.kind === 'not seen' && missed.outcome.next !== null);
  assert.equal(liveWords(missed, game).play, null);
  assert.match(liveWords(missed, game).status, /^Outcome not seen/);
  // Every other 4th down still finds its play.
  assert.equal(found.filter((d) => d.outcome.kind === 'played').length, 7);
});

test('a page loaded right after a punt does not start a 4th down', () => {
  const i = snapshots.findIndex((s) => s.lastPlay?.id === '4018730103135');
  const { found } = run(snapshots.slice(i, i + 3));
  assert.deepEqual(found, []);
});

test('calls from the play', () => {
  const play = (type: string, text: string) => ({ id: 'x', type, text, start: { yardLine: 50, team: '3' } });
  assert.deepEqual(callOf(play('Punt', 'T.Taylor punts 42 yards')), { call: 'punt', fake: false });
  assert.deepEqual(callOf(play('Field Goal Missed', 'C.Santos 53 yard field goal is No Good')), { call: 'field goal', fake: false });
  assert.deepEqual(callOf(play('Pass Reception', '(Punt formation) B.Pinion pass short right')), { call: 'go', fake: true });
  assert.deepEqual(callOf(play('Sack', 'C.Williams sacked')), { call: 'go', fake: false });
  assert.deepEqual(callOf(play('Penalty', 'T.Taylor punts 50 yards. PENALTY on NE, Roughing the Kicker')), { call: 'punt', fake: false });
  assert.deepEqual(callOf(play('Penalty', 'PENALTY on NE, Defensive Offside, 5 yards')), { call: null, fake: false });
});

test('words, the model situation and fixed-order options for a live 4th down', () => {
  const chi = run(snapshots).found.find((d) => d.outcome.kind === 'played' && d.outcome.play.id === '4018730103386')!;
  const words = liveWords(chi, game);
  assert.equal(words.down, '4th and 2 at NE 43');
  assert.equal(words.clock, 'Q4 9:40');
  assert.equal(words.timeouts, 'Timeouts: CHI 2, NE 3');
  assert.equal(words.status, 'Went for it:');
  assert.match(words.play!, /C\.Williams pass short middle/);

  const s = situationOf(chi, game)!;
  assert.deepEqual(
    [s.posteam, s.defteam, s.home, s.yardline100, s.distance, s.secondsRemaining, s.halfSecondsRemaining, s.timeoutsOffense, s.timeoutsDefense],
    ['CHI', 'NE', 'CHI', 43, 2, 580, 580, 2, 3],
  );
  assert.equal(s.scoreDiff, chi.before.homeScore! - chi.before.awayScore!);
  assert.equal(situationOf(chi, { ...game, roof: null })!.roof, 'closed');

  const dir = join(import.meta.dirname, '..', 'models', 'fourth-down');
  const read = (f: string) => JSON.parse(readFileSync(join(dir, f), 'utf8'));
  const files: ModelFiles = {
    manifest: read('manifest.json'), fdModel: read('fd_model.json'), epModel: read('ep_model.json'),
    homeWpModel: read('home_wp_model.json'), wpSpreadModel: read('wp_spread_model.json'),
    twoPtModel: read('two_pt_model.json'), tables: read('tables.json'), terms: read('terms.json'),
    sneak: read('sneak.json'), punter: read('punter.json'), coverage: read('coverage.json'),
    teamPunters: read('teamPunters.json'),
  };
  assert.equal(loadFourthDownModel(files), true);
  const options = optionRows(recommend(s));
  assert.ok('rows' in options);
  assert.deepEqual(options.rows.map((r) => r.label), ['Go for it', 'Field goal', 'Punt']);
  assert.ok(options.rows.every((r) => /%$|too long|not considered/.test(r.value)));
  assert.deepEqual(optionRows({ supported: false, reason: 'overtime' }), { message: "nfl4th doesn't compute decisions in overtime." });

  // No punterId on a live 4th down: the line names the team punter the
  // experimental model fell back on, by its term's label.
  const result = recommend(s);
  assert.ok(result.supported && result.experimental.supported);
  const chiPunter = files.teamPunters.teams.CHI.name;
  assert.equal(punterLine(result, s), `Experimental model: assumed CHI's most recent punter, Punter (${chiPunter}).`);
  assert.equal(punterLine(result, { ...s, punterId: '123' }), null);
  assert.equal(punterLine({ ...result, wpPunt: null }, s), null);
  assert.equal(punterLine({ ...result, experimental: { supported: false, reason: 'season' } }, s), null);
  const unknown = { ...result, experimental: { ...result.experimental, flags: { ...result.experimental.flags, punterUnknown: true } } };
  assert.equal(punterLine(unknown, s), 'Experimental model: no CHI punter found, so it assumed a league-average punter.');
  assert.equal(punterLine({ supported: false, reason: 'overtime' }, s), null);
});
