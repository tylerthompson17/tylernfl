/**
 * Live records: when the scoreboard poll sees a regular season game go final
 * that standings.json does not count yet, both teams' records move at once
 * (W, L, T, Pct, PF, PA, Diff, Div, Conf, Strk) instead of waiting for the
 * next pipeline run. Order, seeds, division places and tiebreaks do not
 * move here: they need the tiebreakers, which only the pipeline runs
 * (pipelines/standings.py), and the game day job publishes them within the
 * hour (.github/workflows/gameday.yml).
 *
 * The page embeds each team's standing as built (`LiveRecordsData`), so
 * every update starts from that base and applying the same final twice
 * cannot count it twice.
 */
import { formatPct, formatRecord, formatSigned } from '../standings/format.ts';

/** Shown under records once one has moved; until then the page is as built. */
export const LIVE_RECORDS_NOTE =
  'Records include games that just ended. Seeds, order and tiebreaks catch up within the hour.';

export type WLT = [number, number, number];

export interface BaseRecord {
  division: string;
  conference: string;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  divisionRecord: WLT;
  conferenceRecord: WLT;
  streak: string | null;
}

/** Embedded in every page as JSON (BaseLayout), keyed by team abbr. */
export type LiveRecordsData = Record<string, BaseRecord>;

export interface LiveFinal {
  away: string;
  home: string;
  awayScore: number;
  homeScore: number;
}

/** "W3" then a win is "W4"; then a loss is "L1". */
export function nextStreak(streak: string | null, result: 'W' | 'L' | 'T'): string {
  const match = streak?.match(/^([WLT])(\d+)$/);
  return match && match[1] === result ? `${result}${Number(match[2]) + 1}` : `${result}1`;
}

/** Ties count as half a win, 3 decimals, as pipelines/standings.py writes it. */
export function winPct(wins: number, losses: number, ties: number): number {
  const games = wins + losses + ties;
  return games ? Math.round(((wins + ties / 2) / games) * 1000) / 1000 : 0;
}

function add([w, l, t]: WLT, result: 'W' | 'L' | 'T'): WLT {
  return [w + (result === 'W' ? 1 : 0), l + (result === 'L' ? 1 : 0), t + (result === 'T' ? 1 : 0)];
}

/**
 * Each affected team's record after the finals, in kickoff order. Teams
 * the page has no base for (another season's standings) are skipped.
 */
export function applyFinals(base: LiveRecordsData, finals: LiveFinal[]): Map<string, BaseRecord> {
  const out = new Map<string, BaseRecord>();
  for (const game of finals) {
    const away = out.get(game.away) ?? base[game.away];
    const home = out.get(game.home) ?? base[game.home];
    if (!away || !home) continue;
    const sides: [string, BaseRecord, number, number, BaseRecord][] = [
      [game.away, away, game.awayScore, game.homeScore, home],
      [game.home, home, game.homeScore, game.awayScore, away],
    ];
    for (const [team, rec, scored, allowed, opponent] of sides) {
      const result = scored > allowed ? 'W' : scored < allowed ? 'L' : 'T';
      out.set(team, {
        ...rec,
        wins: rec.wins + (result === 'W' ? 1 : 0),
        losses: rec.losses + (result === 'L' ? 1 : 0),
        ties: rec.ties + (result === 'T' ? 1 : 0),
        pointsFor: rec.pointsFor + scored,
        pointsAgainst: rec.pointsAgainst + allowed,
        divisionRecord: rec.division === opponent.division ? add(rec.divisionRecord, result) : rec.divisionRecord,
        conferenceRecord:
          rec.conference === opponent.conference ? add(rec.conferenceRecord, result) : rec.conferenceRecord,
        streak: nextStreak(rec.streak, result),
      });
    }
  }
  return out;
}

export type RecordField = 'record' | 'w' | 'l' | 't' | 'pct' | 'pf' | 'pa' | 'diff' | 'div' | 'conf' | 'strk';

/** Each field as the page writes it (StandingsTable, PlayoffPicture, the team header). */
export function recordText(rec: BaseRecord): Record<RecordField, string> {
  return {
    record: formatRecord([rec.wins, rec.losses, rec.ties]),
    w: String(rec.wins),
    l: String(rec.losses),
    t: String(rec.ties),
    pct: formatPct(winPct(rec.wins, rec.losses, rec.ties)),
    pf: String(rec.pointsFor),
    pa: String(rec.pointsAgainst),
    diff: formatSigned(rec.pointsFor - rec.pointsAgainst),
    div: formatRecord(rec.divisionRecord),
    conf: formatRecord(rec.conferenceRecord),
    strk: rec.streak ?? '',
  };
}
