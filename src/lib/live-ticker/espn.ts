/**
 * Parsing for ESPN's public NFL scoreboard (site.api.espn.com), used only by
 * the live ticker in the browser. ESPN data is never written to src/data or
 * used by the pipelines.
 *
 * The API is unofficial and undocumented, so every field is read defensively:
 * anything unexpected yields null and the ticker keeps its ticker.json data.
 */

export const SCOREBOARD_URL = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';

export type LiveState = 'pre' | 'live' | 'final';

export interface LiveGame {
  state: LiveState;
  awayScore: number | null;
  homeScore: number | null;
  /**
   * Text for the detail slot. Null for scheduled games, whose kickoff time the
   * ticker formats in the visitor's time zone instead of using ESPN's text.
   */
  detail: string | null;
}

/**
 * ESPN request parameters for an nflverse week. nflverse numbers postseason
 * rounds 19 to 22; ESPN uses season type 3 with weeks 1 to 5, where week 4 is
 * the Pro Bowl.
 */
export function scoreboardParams(season: number, week: number): { dates: string; seasontype: string; week: string } {
  const postseason: Record<number, number> = { 19: 1, 20: 2, 21: 3, 22: 5 };
  const espnWeek = postseason[week];
  return {
    dates: String(season),
    seasontype: espnWeek ? '3' : '2',
    week: String(espnWeek ?? week),
  };
}

export function scoreboardUrl(season: number, week: number): string {
  return `${SCOREBOARD_URL}?${new URLSearchParams(scoreboardParams(season, week))}`;
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null;

function score(value: unknown): number | null {
  const n = typeof value === 'string' ? Number.parseInt(value, 10) : typeof value === 'number' ? value : NaN;
  return Number.isFinite(n) ? n : null;
}

/**
 * PROVISIONAL: in-progress formatting is based on ESPN's documented status
 * names, not yet checked against a real in-progress response. Finalize and
 * test against tests/fixtures/espn/ once the Thursday capture exists.
 */
export function inProgressDetail(status: Json): string {
  const type = isObject(status.type) ? status.type : {};
  const period = typeof status.period === 'number' ? status.period : 0;
  const clock = typeof status.displayClock === 'string' ? status.displayClock : '';
  const quarter = period > 4 ? 'OT' : `Q${period}`;

  switch (type.name) {
    case 'STATUS_HALFTIME':
      return 'Half';
    case 'STATUS_END_PERIOD':
      return `End ${quarter}`;
    case 'STATUS_IN_PROGRESS':
      return period > 0 && clock ? `${quarter} ${clock}` : 'Live';
    default:
      return typeof type.shortDetail === 'string' ? type.shortDetail : 'Live';
  }
}

export function parseEvent(event: unknown): [string, LiveGame] | null {
  if (!isObject(event) || typeof event.id !== 'string' || !isObject(event.status)) return null;
  const type = event.status.type;
  const competition = Array.isArray(event.competitions) ? event.competitions[0] : null;
  if (!isObject(type) || !isObject(competition) || !Array.isArray(competition.competitors)) return null;

  const competitors: unknown[] = competition.competitors;
  const side = (homeAway: string): Json | undefined =>
    competitors.find((c): c is Json => isObject(c) && c.homeAway === homeAway);
  const away = side('away');
  const home = side('home');
  if (!away || !home) return null;

  const period = typeof event.status.period === 'number' ? event.status.period : 0;

  if (type.completed === true) {
    return [
      event.id,
      { state: 'final', awayScore: score(away.score), homeScore: score(home.score), detail: period > 4 ? 'Final/OT' : 'Final' },
    ];
  }
  if (type.state === 'in') {
    return [
      event.id,
      { state: 'live', awayScore: score(away.score), homeScore: score(home.score), detail: inProgressDetail(event.status) },
    ];
  }
  // Scheduled, or a status like postponed that ESPN marks without completing.
  const scheduled = type.name === 'STATUS_SCHEDULED';
  return [
    event.id,
    {
      state: 'pre',
      awayScore: null,
      homeScore: null,
      detail: scheduled ? null : typeof type.description === 'string' ? type.description : null,
    },
  ];
}

/**
 * Live games keyed by ESPN event id, or null when the response is not the
 * expected season and week or is not shaped as expected.
 */
export function parseScoreboard(data: unknown, season: number, week: number): Map<string, LiveGame> | null {
  if (!isObject(data) || !isObject(data.season) || !isObject(data.week) || !Array.isArray(data.events)) return null;

  const expected = scoreboardParams(season, week);
  if (
    data.season.year !== season ||
    String(data.season.type) !== expected.seasontype ||
    String(data.week.number) !== expected.week
  ) {
    return null;
  }

  const games = new Map<string, LiveGame>();
  for (const event of data.events) {
    const parsed = parseEvent(event);
    if (parsed) games.set(parsed[0], parsed[1]);
  }
  return games;
}
