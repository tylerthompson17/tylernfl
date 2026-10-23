/**
 * Checks the live 4th down detector (src/lib/live-fourth/tracker.ts)
 * against ESPN's game summaries, on a capture from capture-live-fourth.ts.
 *
 *   node scripts/compare-live-fourth.ts --dir capture
 *
 * Each game is run twice through the detector, as the page would see it:
 * - every change the 10-second capture recorded;
 * - a 30-second subsample, the state a 30-second poll would have seen
 *   (the last change at or before each tick), at three offsets (0, 10 and
 *   20 seconds), since where a poll falls changes what it catches.
 *
 * Expected: every 4th down snap in the summary (start.down 4, a run, pass,
 * sack, punt, field goal or turnover; penalties and stoppages are not
 * snaps), from the first poll on. For each run it reports:
 * - match: the detector answered the 4th down with that play and the same call;
 * - mismatch: answered with that play but a different call, or answered
 *   with a play that is not a 4th down snap in the summary;
 * - miss: no 4th down answered by that play, split into "not seen" (the
 *   detector had a 4th down there but its answer never showed) and "never
 *   on the scoreboard" (no poll showed the 4th down at all).
 * Writes <dir>/report.md and prints it. Reads only.
 */
import { readdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import type { Snapshot } from '../src/lib/live-fourth/snapshot.ts';
import { callOf, stepAll, type GameTrack, type LiveFourthDown, type TeamCall } from '../src/lib/live-fourth/tracker.ts';

const { values } = parseArgs({ options: { dir: { type: 'string', default: 'capture' } } });
const dir = values.dir!;

interface SummaryPlay {
  id: string;
  type: { text: string };
  text: string;
  wallclock?: string;
  period: { number: number };
  clock: { displayValue: string };
  start: { down?: number; distance?: number; yardLine?: number; team?: { id?: string } };
}

const SNAP = /rush|pass|sack|punt|field goal|fumble|interception|safety|touchdown/i;
const NOT_SNAP = /penalty|timeout|end |two-minute|kickoff|extra point|two point/i;

function expectedOf(summary: { drives?: { previous?: { plays: SummaryPlay[] }[] } }, from: string): SummaryPlay[] {
  const plays = (summary.drives?.previous ?? []).flatMap((d) => d.plays);
  return plays.filter(
    (p) =>
      p.start?.down === 4 &&
      SNAP.test(p.type.text) &&
      !NOT_SNAP.test(p.type.text) &&
      (!p.wallclock || p.wallclock >= from),
  );
}

/** The call a summary play shows, by the same rule the detector uses. */
const expectedCall = (p: SummaryPlay): TeamCall | null =>
  callOf({ id: p.id, type: p.type.text, text: p.text, start: { yardLine: p.start.yardLine ?? null, team: p.start.team?.id ?? null } }).call;

/** Every 4th down the detector found, in order, run one poll at a time. */
function detect(polls: Snapshot[]): LiveFourthDown[] {
  let tracks = new Map<string, GameTrack>();
  const found = new Map<string, LiveFourthDown>();
  for (const s of polls) {
    tracks = stepAll(tracks, [s]);
    const current = tracks.get(s.event)?.current;
    if (current) found.set(current.firstSeen, current);
  }
  return [...found.values()];
}

/** What a poll every `seconds` would have seen, starting `offset` seconds after the first. */
function subsample(changes: Snapshot[], seconds: number, offset: number): Snapshot[] {
  if (changes.length === 0) return [];
  const start = Date.parse(changes[0].seen) + offset * 1000;
  const end = Date.parse(changes.at(-1)!.seen);
  const polls: Snapshot[] = [];
  let i = 0;
  for (let t = start; t <= end + seconds * 1000; t += seconds * 1000) {
    while (i + 1 < changes.length && Date.parse(changes[i + 1].seen) <= t) i += 1;
    if (Date.parse(changes[i].seen) <= t) polls.push({ ...changes[i], seen: new Date(t).toISOString() });
  }
  return polls;
}

interface Tally {
  match: number;
  mismatch: string[];
  notSeen: string[];
  neverShown: string[];
  pending: number;
}

function compare(found: LiveFourthDown[], expected: SummaryPlay[]): Tally {
  const tally: Tally = { match: 0, mismatch: [], notSeen: [], neverShown: [], pending: 0 };
  const byPlay = new Map<string, LiveFourthDown>();
  for (const d of found) if (d.outcome.kind === 'played') byPlay.set(d.outcome.play.id, d);
  const label = (p: SummaryPlay) => `Q${p.period.number} ${p.clock.displayValue} ${p.type.text}: ${p.text.trim().slice(0, 70)}`;

  for (const p of expected) {
    const d = byPlay.get(p.id);
    if (d && d.outcome.kind === 'played') {
      if (d.outcome.call === expectedCall(p)) tally.match += 1;
      else tally.mismatch.push(`${label(p)} (detector: ${d.outcome.call ?? 'no call'}, summary: ${expectedCall(p)})`);
      continue;
    }
    // A 4th down the detector held at this spot but never saw answered.
    const held = found.some(
      (f) => f.outcome.kind !== 'played' && f.before.possession === (p.start.team?.id ?? null) && f.before.period === p.period.number,
    );
    (held ? tally.notSeen : tally.neverShown).push(label(p));
  }
  const ids = new Set(expected.map((p) => p.id));
  for (const d of found) {
    if (d.outcome.kind === 'pending') tally.pending += 1;
    if (d.outcome.kind === 'played' && !ids.has(d.outcome.play.id) && d.outcome.play.type !== 'Penalty') {
      tally.mismatch.push(`answered by a play that is not a 4th down snap in the summary: ${d.outcome.play.type}: ${d.outcome.play.text.slice(0, 70)}`);
    }
  }
  return tally;
}

const runs = [
  { name: '10-second capture', pick: (c: Snapshot[]) => c },
  { name: '30-second, offset 0 s', pick: (c: Snapshot[]) => subsample(c, 30, 0) },
  { name: '30-second, offset 10 s', pick: (c: Snapshot[]) => subsample(c, 30, 10) },
  { name: '30-second, offset 20 s', pick: (c: Snapshot[]) => subsample(c, 30, 20) },
];

const games = readdirSync(dir, { withFileTypes: true })
  .filter((e) => e.isDirectory() && existsSync(join(dir, e.name, 'snapshots.jsonl')))
  .map((e) => e.name)
  .sort();

const lines: string[] = [`# Live 4th down detector against ESPN summaries`, ``, `Capture: ${dir}, ${games.length} games.`, ``];
const totals = runs.map(() => ({ expected: 0, match: 0, mismatch: 0, notSeen: 0, neverShown: 0 }));
const details: string[] = [];

for (const event of games) {
  const changes: Snapshot[] = readFileSync(join(dir, event, 'snapshots.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const summaryPath = join(dir, event, 'summary.json');
  if (!existsSync(summaryPath)) {
    details.push(`## ${event}`, '', 'No summary (the game did not finish within the capture), so not compared.', '');
    continue;
  }
  const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
  const teams = (summary.header?.competitions?.[0]?.competitors ?? []) as { homeAway: string; team: { abbreviation: string } }[];
  const name = `${teams.find((t) => t.homeAway === 'away')?.team.abbreviation} at ${teams.find((t) => t.homeAway === 'home')?.team.abbreviation}`;
  const expected = expectedOf(summary, changes[0].seen);
  details.push(`## ${name} (${event}): ${expected.length} 4th down snaps`, '');
  runs.forEach((run, i) => {
    const tally = compare(detect(run.pick(changes)), expected);
    const t = totals[i];
    t.expected += expected.length;
    t.match += tally.match;
    t.mismatch += tally.mismatch.length;
    t.notSeen += tally.notSeen.length;
    t.neverShown += tally.neverShown.length;
    details.push(
      `- ${run.name}: ${tally.match} match, ${tally.mismatch.length} mismatch, ${tally.notSeen.length} not seen, ` +
        `${tally.neverShown.length} never on the scoreboard${tally.pending ? `, ${tally.pending} still pending` : ''}`,
    );
    for (const m of tally.mismatch) details.push(`  - mismatch: ${m}`);
    for (const m of tally.notSeen) details.push(`  - not seen: ${m}`);
    for (const m of tally.neverShown) details.push(`  - never on the scoreboard: ${m}`);
  });
  details.push('');
}

lines.push('| Run | 4th downs | Match | Mismatch | Not seen | Never on the scoreboard |', '|---|---|---|---|---|---|');
runs.forEach((run, i) => {
  const t = totals[i];
  lines.push(`| ${run.name} | ${t.expected} | ${t.match} | ${t.mismatch} | ${t.notSeen} | ${t.neverShown} |`);
});
lines.push('', ...details);
const report = lines.join('\n');
writeFileSync(join(dir, 'report.md'), `${report}\n`);
console.log(report);
