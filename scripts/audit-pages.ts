/**
 * Loads pages of the built site at three widths and reports what a browser
 * sees: console errors, failed requests, horizontal overflow, axe
 * accessibility violations, and page weight. Used by the site-auditor agent.
 *
 * Page weight is a first visit (a fresh browser each load, nothing cached),
 * by type: HTML, JS, CSS, fonts, images, other. The preview server does not
 * compress, and GitHub Pages gzips text, so `transfer` estimates the wire
 * size: HTML, JS, CSS, SVG and JSON gzipped here, everything else as is.
 * `bytes` is uncompressed. A page whose transfer is over 500 KB is flagged.
 * `inlineCss` is the share of each page's HTML that is the site's stylesheet
 * (the <style> blocks in <head>; chart SVGs carry their own <style>, which is
 * not counted). `fiveViews` in the report estimates what a visitor transfers
 * over the first five pages given (at 1440px): with the CSS inlined, as the
 * site is built, and with the same CSS in one external stylesheet fetched
 * once and cached. It only measures; the CSS setup is CLAUDE.md's call.
 *
 *   node scripts/audit-pages.ts / /stats/ /standings/ /teams/BUF/
 *   node scripts/audit-pages.ts --no-build /scores/
 *   node scripts/audit-pages.ts --state sunday / /scores/
 *
 * Paths are relative to the base path (/tylernfl). Builds the site, serves it
 * with `astro preview` on its own port, and stops the server when done.
 * Screenshots go to audit/screenshots/ (gitignored). The JSON report is
 * printed to stdout and saved as audit/report.json; build and server output
 * go to stderr so stdout stays parseable.
 *
 * --state <name> builds the site as it reads at one of the moments in
 * tests/fixtures/states/states.json instead. The state's data set is
 * gitignored and generated on first use (tests/fixtures/states/generate.py,
 * through the pipelines' virtual environment and nflverse, a minute or two),
 * and again whenever the pipeline code has changed since (a hash kept in the
 * set's generated.json); --regenerate forces it. A copy of the site is staged in
 * audit/states/<name>/site/ with that state's data in place of src/data, and
 * built with SITE_NOW at the state's time, so the browser's clock reads it
 * too. The page's requests to ESPN never leave the machine: a state with
 * recorded ESPN files (tests/fixtures/espn/) is served them, any other ESPN
 * request is blocked, and every one is listed in the report. Pages load in
 * US Eastern time so kickoff times read the same on every machine.
 * Screenshots go to audit/screenshots/<name>/, the report to
 * audit/report-<name>.json. The repo's own src/data is never touched.
 */

import { spawn, spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { cp, mkdir, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import AxeBuilder from '@axe-core/playwright';
import { chromium, type Browser, type BrowserContext, type Page, type Response } from 'playwright';

const WIDTHS = [1440, 1024, 390];
const HEIGHT = 900;
const BASE = '/tylernfl';
const STATES_DIR = 'tests/fixtures/states';
const ESPN_DIR = 'tests/fixtures/espn';
const PYTHON = 'pipelines/.venv/bin/python';
// What a staged copy of the site needs to build: the site itself, and
// Tyler's chart scripts, which the chart collection checks exist.
const SITE_FILES = ['src', 'public', 'astro.config.mjs', 'package.json', 'tsconfig.json', 'pipelines/charts/mine'];
const WEIGHT_BUDGET = 500 * 1024;
const WEIGHT_TYPES = ['html', 'js', 'css', 'font', 'image', 'other'] as const;
type WeightType = (typeof WEIGHT_TYPES)[number];
// Long enough for a changed score's 2 second highlight to fade.
const SETTLE_MS = 2500;

interface State {
  description: string;
  now: string;
  espn?: { scoreboard: string; summaries: string };
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    'no-build': { type: 'boolean', default: false },
    state: { type: 'string' },
    regenerate: { type: 'boolean', default: false },
    port: { type: 'string', default: '4323' },
    out: { type: 'string', default: 'audit' },
  },
});

if (positionals.length === 0) {
  console.error('Give at least one page path, e.g. node scripts/audit-pages.ts / /stats/');
  process.exit(2);
}

const port = Number(values.port);
const origin = `http://localhost:${port}`;
const outDir = values.out;
const stateName = values.state;
const shotDir = stateName ? `${outDir}/screenshots/${stateName}` : `${outDir}/screenshots`;
const reportPath = stateName ? `${outDir}/report-${stateName}.json` : `${outDir}/report.json`;

let state: State | null = null;
let generated: Record<string, string> | null = null;
if (stateName) {
  const states: Record<string, State> = JSON.parse(await readFile(`${STATES_DIR}/states.json`, 'utf8'));
  state = states[stateName] ?? null;
  if (!state) {
    console.error(`No state ${stateName}; states: ${Object.keys(states).join(', ')}`);
    process.exit(2);
  }
  if (!existsSync(PYTHON)) {
    console.error(`The ${stateName} data set needs the pipelines' virtual environment (${PYTHON})`);
    process.exit(1);
  }
  // A set made by older pipeline code is stale: regenerate it.
  const hash = spawnSync(PYTHON, [`${STATES_DIR}/generate.py`, '--hash'], { encoding: 'utf8' }).stdout.trim();
  const setFile = `${STATES_DIR}/${stateName}/generated.json`;
  const setHash = existsSync(setFile) ? JSON.parse(await readFile(setFile, 'utf8')).pipelineHash : null;
  if (!hash) {
    console.error('Could not compute the pipeline hash (generate.py --hash)');
    process.exit(1);
  }
  if (values.regenerate || setHash !== hash) {
    console.error(
      !existsSync(setFile)
        ? `Generating the ${stateName} data set`
        : `Regenerating the ${stateName} data set (${values.regenerate ? '--regenerate' : `pipeline code changed: ${setHash ?? 'no hash'} to ${hash}`})`,
    );
    const generate = spawnSync(PYTHON, [`${STATES_DIR}/generate.py`, stateName], { stdio: ['ignore', 2, 2] });
    if (generate.status !== 0) {
      console.error(`Generating the ${stateName} data set failed`);
      process.exit(1);
    }
    // New data needs a new build, whatever --no-build said.
    if (values['no-build']) console.error('Building anyway: the data set changed');
    values['no-build'] = false;
  }
  generated = JSON.parse(await readFile(`${STATES_DIR}/${stateName}/generated.json`, 'utf8'));
}
const siteDir = stateName ? resolve(outDir, 'states', stateName, 'site') : process.cwd();

/** A copy of the site with the state's data in place of src/data. */
async function stageState(name: string): Promise<void> {
  await rm(siteDir, { recursive: true, force: true });
  for (const path of SITE_FILES) {
    await cp(path, `${siteDir}/${path}`, { recursive: true });
  }
  await symlink(resolve('node_modules'), `${siteDir}/node_modules`, 'dir');
  const data = `${siteDir}/src/data`;
  for (const entry of await readdir(data)) {
    if (entry !== 'types.ts') await rm(`${data}/${entry}`, { recursive: true });
  }
  await cp(`${STATES_DIR}/${name}`, data, {
    recursive: true,
    filter: (source) => !source.endsWith('generated.json'),
  });
}

if (!values['no-build']) {
  if (stateName) await stageState(stateName);
  const build = spawnSync('npx', ['astro', 'build'], {
    cwd: siteDir,
    stdio: ['ignore', 2, 2],
    env: state ? { ...process.env, SITE_NOW: state.now } : process.env,
  });
  if (build.status !== 0) {
    console.error('Build failed');
    process.exit(1);
  }
} else if (!existsSync(`${siteDir}/dist`)) {
  console.error(`No build to serve in ${siteDir}; run without --no-build first`);
  process.exit(1);
}

const server = spawn('npx', ['astro', 'preview', '--port', String(port)], {
  cwd: siteDir,
  stdio: ['ignore', 2, 2],
});

async function waitForServer(): Promise<void> {
  for (let i = 0; i < 60; i++) {
    try {
      await fetch(`${origin}${BASE}/`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`Preview server did not start on ${origin}`);
}

function slugOf(path: string): string {
  return path.replace(/^\/+|\/+$/g, '').replace(/[^a-zA-Z0-9]+/g, '-') || 'home';
}

interface EspnRequest {
  url: string;
  /** The fixture file served, or why nothing was. */
  served: string;
}

/**
 * In a state, answer ESPN from the recorded files: the state's scoreboard
 * for any scoreboard request, a summary file by event id, and nothing for
 * anything else (blocked, so the audit never reaches ESPN).
 */
async function routeEspn(context: BrowserContext, log: EspnRequest[]): Promise<void> {
  await context.route(/^https:\/\/site\.api\.espn\.com\//, async (route) => {
    const url = new URL(route.request().url());
    const espn = state?.espn;
    let file: string | null = null;
    if (espn && url.pathname.endsWith('/scoreboard')) file = espn.scoreboard;
    if (espn && url.pathname.endsWith('/summary')) {
      const candidate = espn.summaries.replace('*', url.searchParams.get('event') ?? '');
      if (existsSync(`${ESPN_DIR}/${candidate}`)) file = candidate;
    }
    if (!file) {
      log.push({ url: url.href, served: espn ? 'no fixture: answered 404' : 'blocked: this state has no ESPN fixtures' });
      if (espn) return route.fulfill({ status: 404, body: '' });
      return route.abort('blockedbyclient');
    }
    log.push({ url: url.href, served: `${ESPN_DIR}/${file}` });
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: await readFile(`${ESPN_DIR}/${file}`, 'utf8'),
    });
  });
}

// Elements that stick out past the right edge of the viewport and are not
// inside something that clips or scrolls them (tables in a scroll frame, the
// ticker's carousel). Only the outermost offender of each branch is listed.
// A positioned element can escape its ancestor's clipping, so when the page
// scrolls sideways and that finds nothing, every element that sticks out is
// listed instead, and `offendersUnfiltered` says so.
async function overflowOf(page: Page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const width = doc.clientWidth;
    const clipped = (el: Element): boolean => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const x = getComputedStyle(p).overflowX;
        if (x !== 'visible') return true;
      }
      return false;
    };
    const find = (skipClipped: boolean) => {
      const offenders: { selector: string; right: number; text: string }[] = [];
      for (const el of Array.from(document.body.querySelectorAll('*'))) {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.right <= width + 1 || (skipClipped && clipped(el))) continue;
        if (offenders.some((o) => el.closest(o.selector) !== null)) continue;
        const id = el.id ? `#${el.id}` : '';
        const cls = el.classList.length ? `.${Array.from(el.classList).join('.')}` : '';
        offenders.push({
          selector: `${el.tagName.toLowerCase()}${id}${cls}`,
          right: Math.round(rect.right),
          text: (el.textContent ?? '').trim().slice(0, 60),
        });
        if (offenders.length >= 10) break;
      }
      return offenders;
    };
    const pageScrollsSideways = doc.scrollWidth > width;
    let offenders = find(true);
    const offendersUnfiltered = pageScrollsSideways && offenders.length === 0;
    if (offendersUnfiltered) offenders = find(false);
    return { pageScrollsSideways, scrollWidth: doc.scrollWidth, clientWidth: width, offenders, offendersUnfiltered };
  });
}

function weightType(response: Response): WeightType {
  const kind = response.request().resourceType();
  if (kind === 'document') return 'html';
  if (kind === 'script') return 'js';
  if (kind === 'stylesheet') return 'css';
  if (kind === 'font') return 'font';
  if (kind === 'image') return 'image';
  return 'other';
}

const COMPRESSED_BY_PAGES = /^(text\/|application\/(javascript|json|xml)|image\/svg\+xml)/;

const gzipSize = (text: string) => gzipSync(Buffer.from(text)).length;

/** The site's stylesheet blocks in a page's <head>, and the HTML without them. */
function splitHeadCss(html: string): { blocks: string[]; without: string } {
  const head = html.match(/<head[\s\S]*?<\/head>/i)?.[0] ?? '';
  const blocks = [...head.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[0]);
  const bareHead = blocks.reduce((h, block) => h.replace(block, ''), head);
  return { blocks, without: html.replace(head, bareHead) };
}

/** What a page contributes to the five views estimate. */
interface Visit {
  path: string;
  htmlTransfer: number;
  htmlTransferWithoutCss: number;
  cssBlocks: string[];
  assets: Map<string, number>;
}

/** Adds up every response a page load receives, by type. */
function weighPage(page: Page, path: string) {
  const totals = Object.fromEntries(WEIGHT_TYPES.map((t) => [t, { requests: 0, bytes: 0, transfer: 0 }])) as Record<
    WeightType,
    { requests: number; bytes: number; transfer: number }
  >;
  const largest: { url: string; type: WeightType; bytes: number; transfer: number }[] = [];
  const pending: Promise<void>[] = [];
  const assets = new Map<string, number>();
  let html: string | null = null;
  page.on('response', (response) => {
    pending.push(
      (async () => {
        let body: Buffer;
        try {
          body = await response.body();
        } catch {
          return; // redirects and aborted requests have no body
        }
        const type = weightType(response);
        const contentType = response.headers()['content-type'] ?? '';
        const transfer = COMPRESSED_BY_PAGES.test(contentType) ? gzipSync(body).length : body.length;
        if (type === 'html' && response.request().frame() === page.mainFrame() && html === null) {
          html = body.toString('utf8');
        } else {
          assets.set(response.url(), transfer);
        }
        totals[type].requests += 1;
        totals[type].bytes += body.length;
        totals[type].transfer += transfer;
        largest.push({ url: response.url(), type, bytes: body.length, transfer });
      })(),
    );
  });
  return async () => {
    await Promise.all(pending);
    const transfer = WEIGHT_TYPES.reduce((sum, t) => sum + totals[t].transfer, 0);
    let inlineCss = null;
    let visit: Visit | null = null;
    if (html !== null) {
      const { blocks, without } = splitHeadCss(html);
      const htmlBytes = Buffer.byteLength(html);
      const cssBytes = blocks.reduce((sum, b) => sum + Buffer.byteLength(b), 0);
      const htmlTransfer = gzipSize(html);
      const htmlTransferWithoutCss = gzipSize(without);
      inlineCss = {
        blocks: blocks.length,
        bytes: cssBytes,
        shareOfHtmlBytes: Number((cssBytes / htmlBytes).toFixed(3)),
        transfer: htmlTransfer - htmlTransferWithoutCss,
        shareOfHtmlTransfer: Number(((htmlTransfer - htmlTransferWithoutCss) / htmlTransfer).toFixed(3)),
      };
      visit = { path, htmlTransfer, htmlTransferWithoutCss, cssBlocks: blocks, assets };
    }
    return {
      weight: {
        transfer,
        bytes: WEIGHT_TYPES.reduce((sum, t) => sum + totals[t].bytes, 0),
        overBudget: transfer > WEIGHT_BUDGET,
        byType: totals,
        inlineCss,
        largest: largest.sort((a, b) => b.transfer - a.transfer).slice(0, 5),
      },
      visit,
    };
  };
}

/**
 * Five page views in a row, first visit: HTML every time, every other file
 * once (the browser keeps it). Inlined, each page carries its CSS; external,
 * each page drops it and one stylesheet holding every distinct block the five
 * pages use is fetched once. That single sheet is the best case for external
 * CSS: Astro would split it into shared and per-page files, adding requests.
 */
function fiveViews(visits: Visit[]) {
  const pages = visits.filter((v, i) => visits.findIndex((w) => w.path === v.path) === i).slice(0, 5);
  if (pages.length < 5) return { notChecked: `needs five different pages, ${pages.length} given` };
  const assets = new Map<string, number>();
  for (const page of pages) for (const [url, size] of page.assets) assets.set(url, size);
  const assetsOnce = [...assets.values()].reduce((sum, n) => sum + n, 0);
  const sheet = [...new Set(pages.flatMap((p) => p.cssBlocks))]
    .map((block) => block.replace(/^<style[^>]*>|<\/style>$/gi, ''))
    .join('\n');
  const inlineHtml = pages.reduce((sum, p) => sum + p.htmlTransfer, 0);
  const externalHtml = pages.reduce((sum, p) => sum + p.htmlTransferWithoutCss, 0);
  const stylesheet = gzipSize(sheet);
  const inlined = inlineHtml + assetsOnce;
  const external = externalHtml + stylesheet + assetsOnce;
  return {
    pages: pages.map((p) => p.path),
    inlined: { transfer: inlined, cssTransfer: inlineHtml - externalHtml, requests: 5 + assets.size },
    externalStylesheet: { transfer: external, cssTransfer: stylesheet, requests: 6 + assets.size },
    difference: inlined - external,
    otherFilesOnce: assetsOnce,
  };
}

// A fresh context per page and width: axe needs one, and nothing (listeners,
// cache, storage) carries over from the previous load.
async function auditPage(browser: Browser, path: string, width: number, visits: Visit[]) {
  const context = await browser.newContext({
    viewport: { width, height: HEIGHT },
    ...(state ? { timezoneId: 'America/New_York' } : {}),
  });
  const espnRequests: EspnRequest[] = [];
  if (state) await routeEspn(context, espnRequests);
  const page = await context.newPage();
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(`Uncaught: ${err.message}`));
  page.on('requestfailed', (req) =>
    failedRequests.push(`${req.url()} (${req.failure()?.errorText ?? 'failed'})`),
  );
  page.on('response', (res) => {
    if (res.status() >= 400) failedRequests.push(`${res.url()} (HTTP ${res.status()})`);
  });

  const weigh = weighPage(page, path);
  const url = `${origin}${BASE}${path.startsWith('/') ? path : `/${path}`}`;
  const response = await page.goto(url, { waitUntil: 'networkidle' });
  if (espnRequests.length > 0) await page.waitForTimeout(SETTLE_MS);
  const { weight, visit } = await weigh();
  if (visit && width === WIDTHS[0]) visits.push(visit);
  const screenshot = `${shotDir}/${slugOf(path)}-${width}.png`;
  await page.screenshot({ path: screenshot, fullPage: true });

  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();

  const overflow = await overflowOf(page);
  await context.close();
  return {
    path,
    width,
    url,
    status: response?.status() ?? null,
    screenshot,
    consoleErrors,
    failedRequests,
    ...(state ? { espnRequests } : {}),
    overflow,
    weight,
    axeViolations: axe.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      count: v.nodes.length,
      targets: v.nodes.slice(0, 5).map((n) => n.target.join(' ')),
    })),
  };
}

let exitCode = 0;
try {
  await mkdir(shotDir, { recursive: true });
  await waitForServer();
  const browser = await chromium.launch();
  const results = [];
  const visits: Visit[] = [];
  for (const path of positionals) {
    for (const width of WIDTHS) {
      try {
        results.push(await auditPage(browser, path, width, visits));
      } catch (err) {
        results.push({ path, width, error: String(err) });
      }
    }
  }
  await browser.close();
  const report = JSON.stringify(
    {
      generated: new Date().toISOString(),
      ...(state ? { state: { name: stateName, siteNow: state.now, description: state.description, data: generated } } : {}),
      fiveViews: fiveViews(visits),
      results,
    },
    null,
    2,
  );
  await writeFile(reportPath, `${report}\n`);
  console.log(report);
} catch (err) {
  console.error(err);
  exitCode = 1;
} finally {
  server.kill();
}
process.exit(exitCode);
