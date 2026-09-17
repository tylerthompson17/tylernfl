/**
 * Captures real ESPN scoreboard responses during a game, as test fixtures for
 * the live ticker's in-progress parsing. Writes only to tests/fixtures/espn/.
 *
 *   node scripts/capture-espn-fixture.ts --season 2026 --week 2 \
 *     --event 401872932 --until 2026-09-18T05:30:00Z
 *
 * Saves the full raw response the first time the game is in progress, plus
 * the game's event object once per distinct status and quarter (halftime,
 * end of quarter, final). Stops after the final or at --until.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

import { scoreboardUrl } from '../src/lib/live-ticker/espn.ts';

const { values } = parseArgs({
  options: {
    season: { type: 'string' },
    week: { type: 'string' },
    event: { type: 'string' },
    until: { type: 'string' },
    interval: { type: 'string', default: '60' },
    out: { type: 'string', default: 'tests/fixtures/espn' },
  },
});

const season = Number(values.season);
const week = Number(values.week);
const eventId = values.event;
const until = new Date(values.until ?? '');
if (!season || !week || !eventId || Number.isNaN(until.getTime())) {
  console.error('Usage: --season 2026 --week 2 --event 401872932 --until 2026-09-18T05:30:00Z');
  process.exit(1);
}

const intervalMs = Number(values.interval) * 1000;
const url = scoreboardUrl(season, week);
const saved = new Set<string>();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

await mkdir(values.out!, { recursive: true });
console.log(`Watching event ${eventId} at ${url} until ${until.toISOString()}`);

while (Date.now() < until.getTime()) {
  try {
    const response = await fetch(url);
    const raw = await response.text();
    const data = JSON.parse(raw);
    const event = data.events?.find((e: { id: string }) => e.id === eventId);
    const status = event?.status;
    const state = status?.type?.state;

    if (!event) {
      console.log(`${new Date().toISOString()} event not in response`);
    } else if (state === 'pre') {
      console.log(`${new Date().toISOString()} scheduled: ${status.type.shortDetail}`);
    } else {
      const label = `${String(status.type.name).toLowerCase().replace(/^status_/, '')}-q${status.period}`;
      console.log(`${new Date().toISOString()} ${label}: ${status.type.shortDetail} (${status.displayClock})`);

      if (state === 'in' && !saved.has('full')) {
        await writeFile(`${values.out}/scoreboard-${season}-week${week}-in-progress.json`, raw);
        saved.add('full');
        console.log('  saved full in-progress response');
      }
      if (!saved.has(label)) {
        const excerpt = { capturedAt: new Date().toISOString(), season: data.season, week: data.week, events: [event] };
        await writeFile(`${values.out}/event-${eventId}-${label}.json`, `${JSON.stringify(excerpt, null, 2)}\n`);
        saved.add(label);
        console.log(`  saved event ${label}`);
      }
      if (status.type.completed === true) {
        console.log('Game is final; done.');
        break;
      }
    }
  } catch (error) {
    console.log(`${new Date().toISOString()} request failed: ${error}`);
  }
  await sleep(intervalMs);
}

console.log(`Saved: ${[...saved].join(', ') || 'nothing'}`);
