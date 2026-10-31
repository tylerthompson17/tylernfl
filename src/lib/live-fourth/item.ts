/**
 * One live 4th down as the home panel, the live page and team pages all
 * show it: game and clock; the situation; what happened, in plain words;
 * tt4th's call and each option's WP under it, leading (never graded against
 * what the team did); then the verdict against nfl4th and nfl4th's WPs,
 * smaller, as the comparison. A 4th down still to be played says what both
 * recommend and is the only item with the yellow background. Styles are
 * .live-item in global.css.
 */
import type { FourthDownResult, FourthDownSituation } from '../fourth-down.ts';
import type { FeedEntry, PendingFourthDown } from './feed.ts';
import { clockWords, gradeOf, optionWords, situationFromSummary, situationWords, teamCallOf, type LiveGrade } from './grade.ts';
import { liveWords, situationOf } from './situation.ts';
import { pendingLine, playSummary, punterLine, tt4thLines, verdictLine } from './words.ts';

/** What the item needs from the model: a cached result, and a way to ask. */
export interface ModelLike {
  state(): 'off' | 'loading' | 'ready' | 'failed';
  result(key: string): FourthDownResult | undefined;
  /** The worker that also computes tt4th, which starts after nfl4th's */
  tt4thState(): 'off' | 'loading' | 'ready' | 'failed';
  tt4thResult(key: string): FourthDownResult | undefined;
  ask(key: string, situation: FourthDownSituation): void;
}

export const entryKey = (e: FeedEntry) =>
  `${e.play.id}|${e.play.yardline100}-${e.play.distance}|${e.timeouts ? `${e.timeouts.offense}-${e.timeouts.defense}` : 'counted'}`;
export const pendingKey = (p: PendingFourthDown) => `pending|${p.event}|${p.down.firstSeen}|${p.down.before.seen}`;

function line(className: string, text: string): HTMLParagraphElement {
  const p = document.createElement('p');
  p.className = className;
  p.textContent = text;
  return p;
}

function modelWaiting(model: ModelLike): string {
  const m = model.state();
  if (m === 'failed') return "nfl4th's numbers are unavailable: the model could not be loaded.";
  if (m === 'loading') return "Loading nfl4th's numbers (the model, about 2.6 MB)…";
  if (m === 'off') return '';
  return "Computing nfl4th's numbers…";
}

/**
 * tt4th's lines, leading the item: its call, its WPs and the punter it
 * assumed; or a line saying they are on the way. Nothing when nfl4th itself
 * has no numbers (overtime, the last 15 seconds), which its own line says.
 * The item is marked so nfl4th's verdict then reads as the comparison.
 */
function appendTt4th(li: HTMLLIElement, key: string, situation: FourthDownSituation | null, model: ModelLike): void {
  if (!situation) return;
  const nfl4th = model.result(key);
  if (nfl4th && !nfl4th.supported) return;
  const full = model.tt4thResult(key);
  const lines = full?.supported ? tt4thLines(full.experimental, situation.yardline100) : null;
  if (lines) {
    li.classList.add('has-tt4th');
    li.append(line('live-tt4th', `${lines.call}.`), line('live-wp live-tt4th-wp', `tt4th: ${lines.wp}. ${lines.asOf}.`));
    const punter = punterLine(full, situation);
    if (punter) li.append(line('live-note', punter));
    return;
  }
  const m = model.tt4thState();
  if (full || m === 'failed') li.append(line('live-note', "tt4th has no numbers here."));
  else if (m !== 'off' || model.state() !== 'off') li.append(line('live-note', "Computing tt4th's numbers…"));
}

/** A played 4th down's situation and cached result, asking the model when it is running. */
function entryResult(e: FeedEntry, model: ModelLike): { situation: FourthDownSituation; result?: FourthDownResult } | null {
  if (e.play.nullified) return null;
  const situation = situationFromSummary(e.play, e.homeId, e.game, e.timeouts);
  if (!situation) return null;
  if (model.state() !== 'off') model.ask(entryKey(e), situation);
  return { situation, result: model.result(entryKey(e)) };
}

/** The grade for a played 4th down, asking the model when it is running; null when nullified. */
export function entryGrade(e: FeedEntry, model: ModelLike): LiveGrade | null {
  const result = entryResult(e, model)?.result;
  return result ? gradeOf(result, teamCallOf(e.play).call) : null;
}

/** `tt4th: false` for a list of grades (the live page's questionable calls), which are nfl4th's alone. */
export function entryItem(e: FeedEntry, model: ModelLike, { tt4th = true } = {}): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'live-item';
  li.dataset.play = e.play.id;
  const { call, fake } = teamCallOf(e.play);
  const play = line('live-play', playSummary(e.play.type, e.play.text, e.play.distance, call, fake));
  play.title = e.play.text;
  const when = line('live-when', `${e.game.away} at ${e.game.home}${e.final ? ' (final)' : ''}, ${clockWords(e.play)}`);
  // A game the build already has a page for (a final the daily job has
  // run for) links its name there.
  if (e.game.page) {
    const a = document.createElement('a');
    a.href = e.game.page;
    a.textContent = `${e.game.away} at ${e.game.home}`;
    when.replaceChildren(a, `${e.final ? ' (final)' : ''}, ${clockWords(e.play)}`);
  }
  li.append(when, line('live-down', situationWords(e.play, e.homeId, e.game)));
  if (e.play.spotUncertain) li.append(line('live-note', "Spot from ESPN's summary, which can be a yard off for kicks."));
  li.append(play);
  if (e.play.nullified) {
    li.classList.add('nullified');
    li.append(line('live-verdict', `Nullified by penalty (${e.play.nullified.toLowerCase()}), not graded`));
    return li;
  }
  const computed = entryResult(e, model);
  if (tt4th) appendTt4th(li, entryKey(e), computed?.situation ?? null, model);
  const grade = computed?.result ? gradeOf(computed.result, call) : null;
  if (grade && computed) {
    li.append(line('live-verdict', verdictLine(grade, call)));
    if (grade.kind === 'graded') li.append(line('live-wp', `${tt4th ? 'nfl4th: ' : ''}${optionWords(grade, e.play.yardline100)}`));
  } else {
    const waiting = modelWaiting(model);
    if (waiting) li.append(line('live-wp', waiting));
  }
  return li;
}

export function pendingItem(p: PendingFourthDown, model: ModelLike): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'live-item pending';
  const words = liveWords(p.down, p.game);
  li.append(
    line('live-when', `${words.game}, ${words.clock}`),
    // "CHI up 6, 27 to 21" -> "up 6", as the played items say it.
    line('live-down', `${words.team} ${words.down}, ${words.score.replace(`${words.team} `, '').split(',')[0]}`),
  );
  const situation = situationOf(p.down, p.game);
  if (situation && model.state() !== 'off') model.ask(pendingKey(p), situation);
  appendTt4th(li, pendingKey(p), situation, model);
  const result = model.result(pendingKey(p));
  if (result) {
    const grade = gradeOf(result, null);
    li.append(line('live-verdict', pendingLine(grade)));
    if (grade.kind === 'graded' && situation) li.append(line('live-wp', `nfl4th: ${optionWords(grade, situation.yardline100)}`));
  } else {
    li.append(line('live-verdict', 'Waiting for the snap.'));
    const waiting = modelWaiting(model);
    if (waiting) li.append(line('live-wp', waiting));
  }
  return li;
}

/** Orders played 4th downs newest first. */
export const entryOrder = (e: FeedEntry) =>
  e.play.wallclock ? Date.parse(e.play.wallclock) : Date.parse(e.game.kickoff ?? '') + e.play.sequence;
