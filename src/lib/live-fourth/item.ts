/**
 * One live 4th down as the home panel, the live page and team pages all
 * show it: game and clock; the situation; what happened, in plain words;
 * the verdict against nfl4th; each option's win probability, smaller. A 4th
 * down still to be played says what nfl4th recommends and is the only item
 * with the yellow background. Styles are .live-item in global.css.
 */
import type { FourthDownResult, FourthDownSituation } from '../fourth-down.ts';
import type { FeedEntry, PendingFourthDown } from './feed.ts';
import { clockWords, gradeOf, optionWords, situationFromSummary, situationWords, teamCallOf, type LiveGrade } from './grade.ts';
import { liveWords, situationOf } from './situation.ts';
import { pendingLine, playSummary, verdictLine } from './words.ts';

/** What the item needs from the model: a cached result, and a way to ask. */
export interface ModelLike {
  state(): 'off' | 'loading' | 'ready' | 'failed';
  result(key: string): FourthDownResult | undefined;
  ask(key: string, situation: FourthDownSituation): void;
}

export const entryKey = (e: FeedEntry) =>
  `${e.play.id}|${e.timeouts ? `${e.timeouts.offense}-${e.timeouts.defense}` : 'counted'}`;
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

/** The grade for a played 4th down, asking the model when it is running; null when nullified. */
export function entryGrade(e: FeedEntry, model: ModelLike): LiveGrade | null {
  if (e.play.nullified) return null;
  const situation = situationFromSummary(e.play, e.homeId, e.game, e.timeouts);
  if (!situation) return null;
  if (model.state() !== 'off') model.ask(entryKey(e), situation);
  const result = model.result(entryKey(e));
  return result ? gradeOf(result, teamCallOf(e.play).call) : null;
}

export function entryItem(e: FeedEntry, model: ModelLike): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'live-item';
  li.dataset.play = e.play.id;
  const { call, fake } = teamCallOf(e.play);
  const play = line('live-play', playSummary(e.play.type, e.play.text, e.play.distance, call, fake));
  play.title = e.play.text;
  li.append(
    line('live-when', `${e.game.away} at ${e.game.home}${e.final ? ' (final)' : ''}, ${clockWords(e.play)}`),
    line('live-down', situationWords(e.play, e.homeId, e.game)),
    play,
  );
  if (e.play.nullified) {
    li.classList.add('nullified');
    li.append(line('live-verdict', `Nullified by penalty (${e.play.nullified.toLowerCase()}), not graded`));
    return li;
  }
  const grade = entryGrade(e, model);
  if (grade) {
    li.append(line('live-verdict', verdictLine(grade, call)));
    if (grade.kind === 'graded') li.append(line('live-wp', optionWords(grade)));
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
  const result = model.result(pendingKey(p));
  if (result) {
    const grade = gradeOf(result, null);
    li.append(line('live-verdict', pendingLine(grade)));
    if (grade.kind === 'graded') li.append(line('live-wp', optionWords(grade)));
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
