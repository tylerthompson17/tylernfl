/**
 * Captures a slate of live games for checking the home page's live 4th
 * down detector (src/lib/live-fourth/) against ESPN's game summaries. Run by
 * .github/workflows/capture-live-fourth.yml, which uploads the output as a
 * workflow artifact: captures are never committed (only trimmed fixtures in
 * tests/fixtures/espn/ are stored ESPN data).
 *
 *   node scripts/capture-live-fourth.ts --season 2026 --week 7 \
 *     --kickoff 2026-10-25T17:00:00Z --out capture
 *
 * Polls ESPN's scoreboard (the ticker's URL, a plain GET) every 30 seconds
 * until a game of the slate kicks off, then every 10. For each game whose
 * kickoff is --kickoff it writes:
 *   <out>/<event>/snapshots.jsonl  every change in the game's state, as
 *                                  snapshot.ts parses it, with the time seen
 *   <out>/<event>/summary.json     the game summary, fetched once at its final
 *   <out>/<event>/summary-plays.jsonl  while the game is live, its summary
 *                                  fetched whenever its last play changes
 *                                  (as the site does: one fetch at a time,
 *                                  a change during one queues one more):
 *                                  per fetch, the time, the response size
 *                                  and only the plays new since the last
 *                                  fetch, so a play's first appearance in
 *                                  the summary can be timed
 * and <out>/polls.jsonl (every poll: time and HTTP status) and
 * <out>/meta.json (what ran and why it stopped).
 *
 * Stops when every game of the slate is final and summarized, after
 * --cap-hours (5), or at once if ESPN refuses (403) or rate-limits (429),
 * or after 5 failed requests in a row. Exits 1 unless it finished cleanly.
 */
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { scoreboardUrl } from '../src/lib/live-ticker/espn.ts';
import { parseSnapshot, type Snapshot } from '../src/lib/live-fourth/snapshot.ts';

const { values } = parseArgs({
  options: {
    season: { type: 'string' },
    week: { type: 'string' },
    kickoff: { type: 'string' },
    out: { type: 'string', default: 'capture' },
    'cap-hours': { type: 'string', default: '5' },
  },
});

const season = Number(values.season);
const week = Number(values.week);
const kickoff = Date.parse(values.kickoff ?? '');
if (!season || !week || Number.isNaN(kickoff)) {
  console.error('Usage: --season 2026 --week 7 --kickoff 2026-10-25T17:00:00Z [--out capture] [--cap-hours 5]');
  process.exit(1);
}

const LIVE_INTERVAL_MS = 10_000;
const WAIT_INTERVAL_MS = 30_000;
const MAX_FAILURES = 5;
const SUMMARY_URL = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary';
const out = values.out!;
const started = Date.now();
const deadline = started + Number(values['cap-hours']) * 3_600_000;
const url = scoreboardUrl(season, week);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (line: string) => console.log(`${new Date().toISOString()} ${line}`);

class Refused extends Error {}

/** A plain GET; ESPN refusing or rate-limiting ends the capture. */
async function get(href: string): Promise<{ status: number; data: unknown }> {
  const response = await fetch(href, { signal: AbortSignal.timeout(15_000) });
  if (response.status === 403 || response.status === 429) {
    throw new Refused(`ESPN returned ${response.status} for ${href}`);
  }
  if (!response.ok) throw new Error(`ESPN returned ${response.status}`);
  return { status: response.status, data: await response.json() };
}

/** What counts as a change worth a line: everything the detector reads. */
interface SummaryPlay {
  id: string;
  type?: { text?: string };
  text?: string;
  period?: { number?: number };
  clock?: { displayValue?: string };
  start?: { down?: number };
  wallclock?: string;
}

/** A game's live summary fetches: what each one added. */
const summaryState = new Map<string, { known: Set<string>; inFlight: boolean; again: boolean; fetches: number; bytes: number }>();
let refused: Refused | null = null;

async function fetchLiveSummary(event: string, trigger: string | null): Promise<void> {
  const state = summaryState.get(event) ?? { known: new Set<string>(), inFlight: false, again: false, fetches: 0, bytes: 0 };
  summaryState.set(event, state);
  if (state.inFlight) {
    state.again = true;
    return;
  }
  state.inFlight = true;
  const fetched = new Date().toISOString();
  try {
    const response = await fetch(`${SUMMARY_URL}?event=${event}`, { signal: AbortSignal.timeout(15_000) });
    if (response.status === 403 || response.status === 429) throw new Refused(`ESPN returned ${response.status} for the ${event} summary`);
    if (!response.ok) throw new Error(`ESPN returned ${response.status}`);
    const text = await response.text();
    const data = JSON.parse(text) as { drives?: { previous?: { plays?: SummaryPlay[] }[]; current?: { plays?: SummaryPlay[] } } };
    const plays = [...(data.drives?.previous ?? []).flatMap((d) => d.plays ?? []), ...(data.drives?.current?.plays ?? [])];
    const fresh = plays.filter((p) => !state.known.has(p.id));
    for (const p of fresh) state.known.add(p.id);
    state.fetches += 1;
    state.bytes += text.length;
    const line = {
      fetched,
      trigger,
      bytes: text.length,
      // Compressed size as sent, when ESPN gives one.
      contentLength: Number(response.headers.get('content-length')) || null,
      plays: state.known.size,
      newPlays: fresh.map((p) => ({
        id: p.id,
        type: p.type?.text ?? '',
        down: p.start?.down ?? null,
        period: p.period?.number ?? null,
        clock: p.clock?.displayValue ?? null,
        wallclock: p.wallclock ?? null,
        text: (p.text ?? '').trim().slice(0, 80),
      })),
    };
    await appendFile(join(out, event, 'summary-plays.jsonl'), `${JSON.stringify(line)}\n`);
  } catch (error) {
    if (error instanceof Refused) refused = error;
    else log(`summary ${event} failed: ${error}`);
  } finally {
    state.inFlight = false;
    if (state.again && !refused) {
      state.again = false;
      void fetchLiveSummary(event, trigger);
    }
  }
}

const keyOf = (s: Snapshot) =>
  JSON.stringify([s.state, s.period, s.clock, s.homeScore, s.awayScore, s.down, s.distance, s.yardLine, s.possession,
    s.homeTimeouts, s.awayTimeouts, s.lastPlay?.id]);

await mkdir(out, { recursive: true });
const last = new Map<string, string>();
const lastPlay = new Map<string, string | null>();
const summarized = new Set<string>();
let slate: string[] = [];
let failures = 0;
let polls = 0;
let stopped = 'cap reached';
let clean = false;

log(`Watching games kicking off ${new Date(kickoff).toISOString()} at ${url}, until ${new Date(deadline).toISOString()}`);

try {
  while (Date.now() < deadline) {
    const seen = new Date().toISOString();
    let response;
    try {
      response = await get(url);
      failures = 0;
    } catch (error) {
      if (error instanceof Refused) throw error;
      failures += 1;
      await appendFile(join(out, 'polls.jsonl'), `${JSON.stringify({ seen, error: String(error) })}\n`);
      log(`poll failed (${failures} in a row): ${error}`);
      if (failures >= MAX_FAILURES) {
        stopped = `${MAX_FAILURES} failed requests in a row`;
        break;
      }
      await sleep(WAIT_INTERVAL_MS);
      continue;
    }
    polls += 1;
    await appendFile(join(out, 'polls.jsonl'), `${JSON.stringify({ seen, status: response.status })}\n`);

    const events = ((response.data as { events?: { id: string; date?: string }[] }).events ?? []).filter(
      (e) => Date.parse(e.date ?? '') === kickoff,
    );
    if (slate.length === 0) {
      slate = events.map((e) => e.id);
      log(`slate: ${slate.join(', ') || 'none found'}`);
      if (slate.length === 0) {
        stopped = 'no game kicks off at --kickoff';
        break;
      }
    }

    if (refused) throw refused;
    let anyLive = false;
    for (const event of events) {
      const s = parseSnapshot(event, seen);
      if (!s) continue;
      if (s.state === 'in') anyLive = true;
      const key = keyOf(s);
      const previous = lastPlay.get(s.event);
      if (last.get(s.event) !== key) {
        last.set(s.event, key);
        await mkdir(join(out, s.event), { recursive: true });
        await appendFile(join(out, s.event, 'snapshots.jsonl'), `${JSON.stringify(s)}\n`);
      }
      // Like the site: the summary again whenever the game's last play changes.
      const playId = s.lastPlay?.id ?? null;
      lastPlay.set(s.event, playId);
      if (s.state === 'in' && playId !== previous) void fetchLiveSummary(s.event, playId);
      if (s.state === 'post' && !summarized.has(s.event)) {
        const summary = await get(`${SUMMARY_URL}?event=${s.event}`);
        await writeFile(join(out, s.event, 'summary.json'), JSON.stringify(summary.data));
        summarized.add(s.event);
        log(`final: ${s.event} (${summarized.size} of ${slate.length})`);
      }
    }
    if (summarized.size === slate.length) {
      stopped = 'every game final';
      clean = true;
      break;
    }
    await sleep(anyLive ? LIVE_INTERVAL_MS : WAIT_INTERVAL_MS);
  }
} catch (error) {
  stopped = String(error instanceof Error ? error.message : error);
  log(`stopping: ${stopped}`);
}

const meta = {
  season, week, kickoff: new Date(kickoff).toISOString(), url,
  started: new Date(started).toISOString(), ended: new Date().toISOString(),
  intervals: { liveSeconds: LIVE_INTERVAL_MS / 1000, waitingSeconds: WAIT_INTERVAL_MS / 1000 },
  polls, slate, summarized: [...summarized], stopped,
  liveSummaries: Object.fromEntries([...summaryState].map(([event, s]) => [event, { fetches: s.fetches, bytes: s.bytes }])),
};
await writeFile(join(out, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`);
log(`done: ${stopped}; ${polls} polls, ${summarized.size} of ${slate.length} games summarized`);
process.exit(clean ? 0 : 1);
