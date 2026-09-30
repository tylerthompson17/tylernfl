/**
 * Build and repository weight for the site-auditor's Weight pass: the size of
 * dist/ and its ten largest files, the repository's size with history, and
 * how much each daily data commit adds, projected to the end of the season.
 * Prints JSON; reads only, apart from the build.
 *
 *   node scripts/audit-weight.ts             # builds first
 *   node scripts/audit-weight.ts --no-build  # measures the dist/ already there
 *
 * A commit's growth is what it added to the object store under src/data: the
 * new file versions it wrote, both uncompressed (`bytes`) and as git keeps
 * them on disk (`disk`, compressed and, once packed, stored as deltas against
 * earlier versions). Disk is the repository's real growth, and it shrinks
 * further after `git gc`, so the projection is an upper bound.
 *
 * The season ends with the Super Bowl. schedule.json carries only the
 * regular season until the playoffs are set, so until then the end is
 * estimated as five weeks after the last regular season game.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseArgs } from 'node:util';

const DAILY_COMMIT = 'Update site data';
const SEASON_END_AFTER_REGULAR = 35; // days: four playoff rounds and the week off before the Super Bowl
const DAY = 86_400_000;

// GitHub's published limits (docs.github.com, "About GitHub Pages" usage
// limits, and "About large files on GitHub"), checked 2026-09-30.
const LIMITS = {
  pagesPublishedSite: { bytes: 1024 ** 3, note: 'Published GitHub Pages sites may be no larger than 1 GB.' },
  pagesSourceRepo: { bytes: 1024 ** 3, note: 'Recommended limit for a Pages source repository: 1 GB.' },
  pagesBandwidthPerMonth: { bytes: 100 * 1024 ** 3, note: 'Soft limit: 100 GB of bandwidth a month.' },
  pagesDeployTimeout: { minutes: 10, note: 'A Pages deployment times out after 10 minutes.' },
  repository: { bytes: 5 * 1024 ** 3, note: 'GitHub recommends repositories under 1 GB, strongly under 5 GB.' },
  fileBlocked: { bytes: 100 * 1024 ** 2, note: 'Files over 100 MiB are blocked; over 50 MiB draws a warning.' },
};

const { values } = parseArgs({ options: { 'no-build': { type: 'boolean', default: false } } });

if (!values['no-build']) {
  const build = spawnSync('npm', ['run', 'build'], { stdio: ['ignore', 2, 2] });
  if (build.status !== 0) {
    console.error('Build failed');
    process.exit(1);
  }
}

const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 28 });

function walk(dir: string): { path: string; bytes: number }[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [{ path, bytes: statSync(path).size }];
  });
}

// dist/
const files = walk('dist');
const byExtension: Record<string, { files: number; bytes: number }> = {};
for (const file of files) {
  const ext = file.path.includes('.') ? file.path.slice(file.path.lastIndexOf('.') + 1) : '(none)';
  byExtension[ext] ??= { files: 0, bytes: 0 };
  byExtension[ext].files += 1;
  byExtension[ext].bytes += file.bytes;
}
const dist = {
  files: files.length,
  bytes: files.reduce((sum, f) => sum + f.bytes, 0),
  byExtension,
  largest: [...files]
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 10)
    .map((f) => ({ path: relative('.', f.path), bytes: f.bytes })),
};

// The repository with its history.
const countObjects = Object.fromEntries(
  git('count-objects', '-v')
    .trim()
    .split('\n')
    .map((line) => line.split(': '))
    .map(([key, value]) => [key, Number(value)]),
);
const repository = {
  // count-objects -v reports KiB; bytes here.
  looseBytes: countObjects['size'] * 1024,
  packBytes: countObjects['size-pack'] * 1024,
  totalBytes: (countObjects['size'] + countObjects['size-pack']) * 1024,
  countObjects,
  srcDataNowBytes: sizeOfTree('HEAD'),
};

function sizeOfTree(commit: string): number {
  return git('ls-tree', '-r', '-l', commit, '--', 'src/data')
    .trim()
    .split('\n')
    .filter(Boolean)
    .reduce((sum, line) => sum + (Number(line.split(/\s+/)[3]) || 0), 0);
}

// Each daily data commit: what it added under src/data.
const commits = git('log', '--reverse', `--grep=${DAILY_COMMIT}`, '--format=%H %cI', '--', 'src/data')
  .trim()
  .split('\n')
  .filter(Boolean)
  .map((line) => {
    const [sha, when] = line.split(' ');
    const blobs = git('diff-tree', '-r', '--no-commit-id', '--diff-filter=AM', sha, '--', 'src/data')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((row) => row.split(/\s+/)[3]);
    let bytes = 0;
    let disk = 0;
    if (blobs.length > 0) {
      const sizes = execFileSync('git', ['cat-file', '--batch-check=%(objectsize) %(objectsize:disk)'], {
        input: blobs.join('\n') + '\n',
        encoding: 'utf8',
      });
      for (const row of sizes.trim().split('\n')) {
        const [raw, onDisk] = row.split(' ').map(Number);
        bytes += raw;
        disk += onDisk;
      }
    }
    return { sha: sha.slice(0, 7), date: when.slice(0, 10), filesChanged: blobs.length, bytes, disk };
  });

// The end of the season, from the schedule the site is built from.
const schedule = JSON.parse(readFileSync('src/data/schedule.json', 'utf8')) as {
  season: number;
  games: { type: string; kickoff: string }[];
};
const lastGame = Math.max(...schedule.games.map((g) => Date.parse(g.kickoff)));
const hasPlayoffs = schedule.games.some((g) => g.type !== 'REG');
const seasonEnd = new Date(hasPlayoffs ? lastGame : lastGame + SEASON_END_AFTER_REGULAR * DAY);

let projection = null;
if (commits.length >= 2) {
  const first = Date.parse(commits[0].date);
  const last = Date.parse(commits.at(-1)!.date);
  const perDay = commits.length / ((last - first) / DAY + 1);
  const remainingDays = Math.max(0, Math.round((seasonEnd.getTime() - last) / DAY));
  const remainingCommits = Math.round(remainingDays * perDay);
  const mean = (key: 'bytes' | 'disk') => commits.reduce((sum, c) => sum + c[key], 0) / commits.length;
  const sorted = commits.map((c) => c.disk).sort((a, b) => a - b);
  projection = {
    seasonEnd: seasonEnd.toISOString().slice(0, 10),
    seasonEndEstimated: !hasPlayoffs,
    commitsPerDay: Number(perDay.toFixed(2)),
    remainingDays,
    remainingCommits,
    meanDiskPerCommit: Math.round(mean('disk')),
    medianDiskPerCommit: sorted[Math.floor(sorted.length / 2)],
    maxDiskPerCommit: sorted.at(-1),
    meanBytesPerCommit: Math.round(mean('bytes')),
    addedDiskBySeasonEnd: Math.round(mean('disk') * remainingCommits),
    repositoryBytesAtSeasonEnd: Math.round(repository.totalBytes + mean('disk') * remainingCommits),
  };
}

console.log(
  JSON.stringify(
    { generated: new Date().toISOString(), limits: LIMITS, dist, repository, dailyCommits: commits, projection },
    null,
    2,
  ),
);
