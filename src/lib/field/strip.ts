/**
 * The field strip: a 4th down drawn on a flat, top-down field, shared by
 * FieldStrip.astro (build time) and the calculator's script (redrawn as the
 * inputs change), so both draw the same markup. Styles are `.field-strip`
 * in global.css, since the calculator sets this markup itself.
 *
 * The offense always drives left to right: its own end zone on the left,
 * the opponent's on the right. Yard lines every 5, numbers every 10 reading
 * 10 to 50 to 10 (every 20 when the strip is narrow), the line of scrimmage
 * in --scrimmage blue, the line to gain in first-down yellow with the gap
 * between them shaded (the goal line when it is goal to go), and when a
 * field goal is an option, a bracket from the spot of the kick to the
 * goalposts with its distance. The field is one image to a screen reader,
 * named by fieldDescription().
 */

export interface FieldState {
  /** Yards from the opponent's goal line, 1 to 99 */
  yardline100: number;
  /** Yards to go; at or past the goal line is goal to go */
  distance: number;
  /** The field goal's distance when one is an option, else null */
  kick: number | null;
  /** Shown above the field: "4th and 7", "4th and 7 at the opponent's 34" */
  label: string;
}

/** Left edge of a yard line, in % of the strip: 120 yards wide with both end zones. */
const x = (yardsFromOwnGoal: number): number => Math.round(((10 + yardsFromOwnGoal) / 120) * 1e4) / 100;

/** "own 44", "the opponent's 34", "midfield", from yards to the opponent's goal line. */
export function spotWords(yardline100: number): string {
  if (yardline100 === 50) return 'midfield';
  return yardline100 > 50 ? `own ${100 - yardline100}` : `the opponent's ${yardline100}`;
}

export const isGoalToGo = (s: Pick<FieldState, 'yardline100' | 'distance'>): boolean => s.distance >= s.yardline100;

/** The whole situation in words, for screen readers. */
export function fieldDescription(s: FieldState): string {
  const gain = isGoalToGo(s) ? 'the goal line' : spotWords(s.yardline100 - s.distance);
  const kick = s.kick === null ? '' : ` A field goal would be a ${s.kick}-yard attempt.`;
  return `${s.label}. Driving left to right toward the opponent's end zone, ball on ${spotWords(s.yardline100)}, line to gain ${gain}.${kick}`;
}

const escape = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function fieldStripHtml(s: FieldState): string {
  const ballOn = 100 - s.yardline100;
  const toGain = isGoalToGo(s) ? 100 : ballOn + s.distance;
  const lines: string[] = [];
  for (let y = 5; y <= 95; y += 5) {
    const kind = y % 20 === 0 ? ' fs-ten' : y % 10 === 0 ? ' fs-ten fs-odd' : '';
    lines.push(`<span class="fs-line${kind}" style="left:${x(y)}%"></span>`);
  }
  const numbers: string[] = [];
  for (let y = 10; y <= 90; y += 10) {
    const n = y <= 50 ? y : 100 - y;
    numbers.push(`<span class="fs-num${y % 20 === 0 ? '' : ' fs-odd'}" style="left:${x(y)}%">${n}</span>`);
  }
  // The kick is from 8 yards behind the line, to the goalposts at the back of the end zone.
  const kick =
    s.kick === null
      ? ''
      : `<div class="fs-kick" aria-hidden="true"><span class="fs-bracket" style="left:${x(110 - s.kick)}%;right:0"></span>` +
        `<span class="fs-kick-label" style="right:0">${s.kick}-yard attempt</span></div>`;
  return (
    `<figure class="field-strip">` +
    `<figcaption class="fs-top"><span class="fs-label">${escape(s.label)}</span><span class="fs-drive" aria-hidden="true">Driving →</span></figcaption>` +
    `<div class="fs-field" role="img" aria-label="${escape(fieldDescription(s))}">` +
    `<span class="fs-ez fs-own" style="left:0;width:${x(0)}%"><span>Own</span></span>` +
    `<span class="fs-ez fs-opp" style="left:${x(100)}%;right:0"><span>Opponent</span></span>` +
    lines.join('') +
    `<span class="fs-gap" style="left:${x(ballOn)}%;width:${Math.round((x(toGain) - x(ballOn)) * 100) / 100}%"></span>` +
    `<span class="fs-gain" style="left:${x(toGain)}%"></span>` +
    `<span class="fs-scrimmage" style="left:${x(ballOn)}%"></span>` +
    numbers.join('') +
    `</div>` +
    `<div class="fs-sides" aria-hidden="true"><span style="left:${x(0)}%;width:${x(50) - x(0)}%">Own side</span>` +
    `<span style="left:${x(50)}%;width:${x(100) - x(50)}%">Opponent's side</span></div>` +
    kick +
    `</figure>`
  );
}

/** The field goal's distance from this spot, or null past the model's longest kick. */
export function fieldGoalKick(yardline100: number, offset: number, longest: number): number | null {
  const kick = yardline100 + offset;
  return kick <= longest ? kick : null;
}
