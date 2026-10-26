/** The words around a replay on its page: which game, the situation, the win probability swing. */
import type { ReplayPlay } from '../../data/types.ts';

const ORDINAL = ['1st', '2nd', '3rd', '4th'];
const ROUNDS = ['wild card round', 'divisional round', 'conference championship', 'Super Bowl'];

/** "CHI at ARI, 2018 week 3" or "SEA at GB, 2019 divisional round". */
export function gameWords(play: ReplayPlay): string {
  const teams = `${play.away} at ${play.home}`;
  if (play.seasonType === 'POST') {
    // Playoff weeks follow the regular season: 18 to 21 through 2020, 19 to 22 since.
    const first = play.season >= 2021 ? 19 : 18;
    const round = ROUNDS[play.week - first];
    if (round) return `${teams}, ${play.season} ${round}`;
  }
  if (play.seasonType === 'PRE') return `${teams}, ${play.season} preseason`;
  return `${teams}, ${play.season} week ${play.week}`;
}

export function quarterText(quarter: number): string {
  return quarter >= 5 ? 'overtime' : `${ORDINAL[quarter - 1]} quarter`;
}

/** "2nd and 6 at CHI 35, 1st quarter, 12:20"; a kickoff or try says so instead of a down. */
export function situationText(play: ReplayPlay, goalToGo: boolean): string {
  const clock = play.clock.replace(/^0(?=\d:)/, '');
  const when = `${quarterText(play.quarter)}, ${clock}`;
  if (play.type === 'kickoff') return `Kickoff, ${when}`;
  if (play.down === null) return `Two point try, ${when}`;
  const distance = goalToGo ? 'goal' : String(play.yardsToGo);
  const spot = play.yardline ? ` at ${play.yardline}` : '';
  return `${ORDINAL[play.down - 1]} and ${distance}${spot}, ${when}`;
}

/** "62% to 70% (+8 points)" for the offense; null without both numbers. */
export function wpSwingText(play: ReplayPlay): string | null {
  if (play.wpBefore === null || play.wpAfter === null) return null;
  const before = Math.round(play.wpBefore * 100);
  const after = Math.round(play.wpAfter * 100);
  const swing = after - before;
  return `${before}% to ${after}% (${swing >= 0 ? '+' : ''}${swing} points)`;
}

/** The scorebug's end of play readout, "→ 70% (+8)", to follow "62%"; null without both numbers. */
export function wpSwingReadout(play: ReplayPlay): string | null {
  if (play.wpBefore === null || play.wpAfter === null) return null;
  const swing = Math.round(play.wpAfter * 100) - Math.round(play.wpBefore * 100);
  return `→ ${Math.round(play.wpAfter * 100)}% (${swing >= 0 ? '+' : ''}${swing})`;
}

/** The scorebug's situation: "2nd and 6 at CHI 35", "Kickoff", "Two point try". */
export function scorebugSituation(play: ReplayPlay, goalToGo: boolean): string {
  if (play.type === 'kickoff') return 'Kickoff';
  if (play.down === null) return 'Two point try';
  return `${ORDINAL[play.down - 1]} and ${goalToGo ? 'goal' : play.yardsToGo}${play.yardline ? ` at ${play.yardline}` : ''}`;
}

/** "September 23, 2018" from an ISO date. */
export function dateText(date: string | null): string | null {
  if (!date) return null;
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
