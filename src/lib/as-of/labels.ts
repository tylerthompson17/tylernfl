/**
 * Every "as of" label on the site: what a panel's numbers are through. One
 * set of rules, so no two panels describe the same moment differently.
 *
 * - A file from an earlier season than the one the site is on (the
 *   offseason, before a new season's first game) names that season and says
 *   it is final: "2025 regular season, final."
 * - A week counts as done only when every one of its regular season games
 *   is final in the schedule. Until then it is "in progress", with how many
 *   of its games are in, so a Sunday afternoon never reads "Through week 2"
 *   on the strength of one Thursday game.
 * - Team stats count games, not weeks: "Through 3 games", "2 to 3 games
 *   per team" around byes and Thursday games.
 * - Game statuses for games still to play are mentioned only while a game
 *   of that week is still to play.
 *
 * Pure: the site's data is bound in src/utils/as-of.ts.
 */

export interface AsOfGame {
  week: number;
  final: boolean;
}

export interface AsOfContext {
  /** The season the site is on: the ticker's, which schedule.json follows. */
  season: number;
  /** That season's regular season games. */
  games: AsOfGame[];
}

export type WeekProgress =
  | { kind: 'prior-season'; season: number }
  | { kind: 'not-started'; season: number }
  | { kind: 'complete'; season: number; week: number }
  | { kind: 'in-progress'; season: number; week: number; played: number; total: number };

/** Where a file that is "through week N" of `season` stands. */
export function weekProgress(ctx: AsOfContext, season: number, throughWeek: number): WeekProgress {
  if (season < ctx.season) return { kind: 'prior-season', season };
  if (throughWeek <= 0) return { kind: 'not-started', season };
  const games = ctx.games.filter((g) => g.week === throughWeek);
  const played = games.filter((g) => g.final).length;
  if (played < games.length) return { kind: 'in-progress', season, week: throughWeek, played, total: games.length };
  return { kind: 'complete', season, week: throughWeek };
}

/** For a panel's foot: "Through week 3." */
export function throughLabel(p: WeekProgress): string {
  switch (p.kind) {
    case 'prior-season':
      return `${p.season} regular season, final.`;
    case 'not-started':
      return 'No games played yet.';
    case 'complete':
      return `Through week ${p.week}.`;
    case 'in-progress':
      return `Week ${p.week} in progress: ${p.played} of ${p.total} games played.`;
  }
}

/** For a page's intro, naming the season: "2026 regular season, through week 3." */
export function seasonLabel(p: WeekProgress): string {
  switch (p.kind) {
    case 'prior-season':
      return `${p.season} regular season, final.`;
    case 'not-started':
      return `${p.season} regular season, before the first game.`;
    case 'complete':
      return `${p.season} regular season, through week ${p.week}.`;
    case 'in-progress':
      return `${p.season} regular season, week ${p.week} in progress: ${p.played} of ${p.total} games played.`;
  }
}

/** "3 games", or "2 to 3 games" when teams stand at different counts. */
export function gamesCount(low: number, high: number): string {
  const noun = high === 1 ? 'game' : 'games';
  return `${low === high ? high : `${low} to ${high}`} ${noun}`;
}

/**
 * Team stats: "Through 3 games." for one team, "Through 2 to 3 games per
 * team." for the league, or the prior season named as final.
 */
export function gamesLabel(ctx: AsOfContext, season: number, low: number, high: number, perTeam = false): string {
  if (season < ctx.season) return `${season} regular season, final.`;
  if (high <= 0) return 'No games played yet.';
  return `Through ${gamesCount(low, high)}${perTeam ? ' per team' : ''}.`;
}

/**
 * The sentence about game statuses for `week`'s games still to play, or
 * null once none is left to play (nothing is still to come) or in the
 * offseason. `summary` is the statuses in words, e.g. "2 out, 1 doubtful".
 */
export function statusLine(ctx: AsOfContext, week: number | null, summary: string | null): string | null {
  if (week === null) return null;
  const left = ctx.games.filter((g) => g.week === week && !g.final).length;
  if (left === 0) return null;
  return `Game statuses for week ${week} games still to play: ${summary ?? 'none filed yet'}.`;
}

/**
 * The week of a set of game logs, named, with how much of it is in:
 * "Week 2's" in season, "2025 week 18's" for an earlier season, and a
 * note while the week is still being played.
 */
export function logWeekLabel(ctx: AsOfContext, season: number, week: number): { name: string; note: string | null } {
  const p = weekProgress(ctx, season, week);
  if (p.kind === 'prior-season') return { name: `${season} week ${week}`, note: null };
  if (p.kind === 'in-progress') return { name: `Week ${week}`, note: `${throughLabel(p)} The rest land as games finish.` };
  return { name: `Week ${week}`, note: null };
}

/** The week recap page with no complete week to show. */
export function recapEmpty(ctx: AsOfContext): { title: string; text: string } {
  const started = ctx.games.some((g) => g.final);
  if (!started) {
    return {
      title: `The ${ctx.season} season has not started`,
      text: `The first recap appears the morning after week 1's last game. Recaps cover the current season only.`,
    };
  }
  return {
    title: 'No complete week yet',
    text: "A week's recap appears the morning after its last game, once every game's play-by-play is out.",
  };
}
