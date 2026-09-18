/**
 * The last scoring play of a live game, from ESPN's per-game summary
 * endpoint, for the line under a pinned game on the ticker. Browser only,
 * like the scoreboard: never written to src/data or used by pipelines.
 *
 * The summary is about 175 KB, of which the scoring plays are about 1 KB,
 * so it is fetched only when a pinned game's score changes, never on every
 * poll. Every field is read defensively; anything unexpected yields null
 * and the ticker simply shows no line.
 */

import { isObject, type Json } from './json.ts';

export const SUMMARY_URL = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary';

export function summaryUrl(eventId: string): string {
  return `${SUMMARY_URL}?${new URLSearchParams({ event: eventId })}`;
}

export interface LastScore {
  /** Which side scored, so the ticker labels it with its own abbreviation. */
  side: 'away' | 'home';
  /** ESPN's short type: "TD", "FG", "SF". */
  kind: string;
  /** ESPN's description, e.g. "Josh Allen 1 Yd Rush (Tyler Bass Kick)". */
  text: string;
  period: number | null;
  clock: string | null;
  /** Score after the play, including any extra point or two point try. */
  awayScore: number;
  homeScore: number;
}

const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** Home or away for an ESPN team id, from the summary header. */
function sideForTeam(data: Json, teamId: unknown): 'away' | 'home' | null {
  const header = isObject(data.header) ? data.header : null;
  const competition = header && Array.isArray(header.competitions) ? header.competitions[0] : null;
  if (!isObject(competition) || !Array.isArray(competition.competitors)) return null;
  for (const competitor of competition.competitors) {
    if (!isObject(competitor) || !isObject(competitor.team)) continue;
    if (competitor.team.id === teamId && (competitor.homeAway === 'home' || competitor.homeAway === 'away')) {
      return competitor.homeAway;
    }
  }
  return null;
}

/**
 * The most recent scoring play, or null when there is none or the response
 * is not shaped as expected. The scoring side comes from the play's team
 * matched against the header; failing that, from whose score went up.
 */
export function parseLastScore(data: unknown): LastScore | null {
  if (!isObject(data) || !Array.isArray(data.scoringPlays) || data.scoringPlays.length === 0) return null;
  const plays: unknown[] = data.scoringPlays;
  const play = plays[plays.length - 1];
  if (!isObject(play) || typeof play.text !== 'string') return null;

  const awayScore = num(play.awayScore);
  const homeScore = num(play.homeScore);
  if (awayScore === null || homeScore === null) return null;

  let side = isObject(play.team) ? sideForTeam(data, play.team.id) : null;
  if (!side) {
    const before = plays.length > 1 && isObject(plays[plays.length - 2]) ? (plays[plays.length - 2] as Json) : {};
    const awayGain = awayScore - (num(before.awayScore) ?? 0);
    const homeGain = homeScore - (num(before.homeScore) ?? 0);
    if (awayGain > 0 && homeGain === 0) side = 'away';
    else if (homeGain > 0 && awayGain === 0) side = 'home';
    else return null;
  }

  const scoringType = isObject(play.scoringType) ? play.scoringType : {};
  const type = isObject(play.type) ? play.type : {};
  const kind =
    typeof scoringType.abbreviation === 'string'
      ? scoringType.abbreviation
      : typeof type.abbreviation === 'string'
        ? type.abbreviation
        : 'Score';

  return {
    side,
    kind,
    text: play.text.trim(),
    period: isObject(play.period) ? num(play.period.number) : null,
    clock: isObject(play.clock) && typeof play.clock.displayValue === 'string' ? play.clock.displayValue : null,
    awayScore,
    homeScore,
  };
}

/** Whether the summary has caught up with the score the ticker shows. */
export function matchesScore(last: LastScore, awayScore: number | null, homeScore: number | null): boolean {
  return last.awayScore === awayScore && last.homeScore === homeScore;
}

/**
 * "Josh Allen 1 Yd Rush (Tyler Bass Kick)" -> "Josh Allen 1 Yd Rush". ESPN
 * sometimes ends the text with a period after the parenthetical.
 */
export function shortPlayText(text: string): string {
  return text.replace(/\s*\([^()]*\)\.?\s*$/, '').trim() || text.trim();
}

/**
 * First name to an initial, ESPN play-by-play style: "Josh Allen" ->
 * "J.Allen", "Amon-Ra St. Brown" -> "A.St. Brown". Names that already
 * start with initials ("T.J. Watt") and single names are left alone.
 */
export function abbreviateName(name: string): string {
  const [first, ...rest] = name.trim().split(/\s+/);
  if (!first || rest.length === 0 || /^(?:\p{L}\.)+$/u.test(first)) return name.trim();
  return `${first[0]}.${rest.join(' ')}`;
}

/**
 * Abbreviate the scorer and, on a passing touchdown, the passer. ESPN's
 * scoring text is "<name> <n> Yd <play>" or "... pass from <name>"; text in
 * any other shape is returned unchanged rather than guessed at.
 */
export function abbreviateNames(text: string): string {
  const match = text.match(/^(.+?) (\d+ Yd .*)$/);
  if (!match) return text;
  const play = match[2]!.replace(/\bpass from (.+)$/, (_, passer: string) => `pass from ${abbreviateName(passer)}`);
  return `${abbreviateName(match[1]!)} ${play}`;
}

/**
 * The visible line (conversion dropped, first names as initials to fit a
 * narrow slot) and its tooltip with ESPN's full text, labeled with the
 * ticker's own team abbreviation (ESPN's can differ, e.g. WSH for WAS).
 */
export function describeLastScore(last: LastScore, team: string): { line: string; title: string } {
  const when =
    last.period === null ? '' : `${last.period > 4 ? 'OT' : `Q${last.period}`}${last.clock ? ` ${last.clock}` : ''}, `;
  return {
    line: `${team} ${last.kind}: ${abbreviateNames(shortPlayText(last.text))}`,
    title: `${when}${team}: ${last.text}`,
  };
}
