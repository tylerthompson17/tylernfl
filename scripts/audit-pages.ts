/**
 * Loads pages of the built site at three widths and reports what a browser
 * sees: console errors, failed requests, horizontal overflow, and axe
 * accessibility violations. Used by the site-auditor agent.
 *
 *   node scripts/audit-pages.ts / /stats/ /standings/ /teams/BUF/
 *   node scripts/audit-pages.ts --no-build /scores/
 *
 * Paths are relative to the base path (/tylernfl). Builds the site, serves it
 * with `astro preview` on its own port, and stops the server when done.
 * Screenshots go to audit/screenshots/ (gitignored). The JSON report is
 * printed to stdout and saved as audit/report.json; build and server output
 * go to stderr so stdout stays parseable. Writes nothing else.
 */

import { spawn, spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

import AxeBuilder from '@axe-core/playwright';
import { chromium, type Browser, type Page } from 'playwright';

const WIDTHS = [1440, 1024, 390];
const HEIGHT = 900;
const BASE = '/tylernfl';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    'no-build': { type: 'boolean', default: false },
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
const shotDir = `${outDir}/screenshots`;

if (!values['no-build']) {
  const build = spawnSync('npm', ['run', 'build'], { stdio: ['ignore', 2, 2] });
  if (build.status !== 0) {
    console.error('Build failed');
    process.exit(1);
  }
}

const server = spawn('npx', ['astro', 'preview', '--port', String(port)], {
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

// Elements that stick out past the right edge of the viewport and are not
// inside something that clips or scrolls them (tables in a scroll frame, the
// ticker's carousel). Only the outermost offender of each branch is listed.
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
    const offenders: { selector: string; right: number; text: string }[] = [];
    for (const el of Array.from(document.body.querySelectorAll('*'))) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.right <= width + 1 || clipped(el)) continue;
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
    return {
      pageScrollsSideways: doc.scrollWidth > width,
      scrollWidth: doc.scrollWidth,
      clientWidth: width,
      offenders,
    };
  });
}

// A fresh context per page and width: axe needs one, and nothing (listeners,
// cache, storage) carries over from the previous load.
async function auditPage(browser: Browser, path: string, width: number) {
  const context = await browser.newContext({ viewport: { width, height: HEIGHT } });
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

  const url = `${origin}${BASE}${path.startsWith('/') ? path : `/${path}`}`;
  const response = await page.goto(url, { waitUntil: 'networkidle' });
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
    overflow,
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
  for (const path of positionals) {
    for (const width of WIDTHS) {
      try {
        results.push(await auditPage(browser, path, width));
      } catch (err) {
        results.push({ path, width, error: String(err) });
      }
    }
  }
  await browser.close();
  const report = JSON.stringify({ generated: new Date().toISOString(), results }, null, 2);
  await writeFile(`${outDir}/report.json`, `${report}\n`);
  console.log(report);
} catch (err) {
  console.error(err);
  exitCode = 1;
} finally {
  server.kill();
}
process.exit(exitCode);
