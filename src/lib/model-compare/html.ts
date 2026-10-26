/**
 * Markup for a model comparison (view.ts): the result (both calls, the
 * disagreement mark, each option's WP under both models, the label, dataAsOf
 * and the flags) and the experimental model's term breakdown. Strings, so
 * the same markup comes from an Astro component at build time
 * (ModelComparison.astro, TermBreakdown.astro) and from a page script in the
 * browser, like the field strip. Styles are model-compare.css.
 */
import type { BreakdownView, ComparisonView, OptionRow } from './view.ts';

const escape = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function callBox(who: string, call: { call: string; margin: string }, className: string): string {
  return (
    `<div class="${className}"><span class="mc-who">${escape(who)}</span>` +
    `<strong class="mc-call-value">${escape(call.call)}</strong>` +
    `<span class="mc-margin">${escape(call.margin)}</span></div>`
  );
}

function wpTable(options: OptionRow[], both: boolean): string {
  const head = both
    ? '<tr><th scope="col">Option</th><th scope="col">Experimental</th><th scope="col">nfl4th</th><th scope="col">Difference</th></tr>'
    : '<tr><th scope="col">Option</th><th scope="col">nfl4th</th></tr>';
  const body = options
    .map((o) => {
      const mark = (best: boolean, text: string, who: string) =>
        best ? `<strong>${escape(text)}</strong><span class="visually-hidden"> (${who}'s call)</span>` : escape(text);
      const cells = both
        ? `<td>${mark(o.bestExperimental, o.experimental, 'experimental model')}</td><td>${mark(o.bestNfl4th, o.nfl4th, 'nfl4th')}</td><td>${escape(o.difference)}</td>`
        : `<td>${mark(o.bestNfl4th, o.nfl4th, 'nfl4th')}</td>`;
      return `<tr><th scope="row">${escape(o.label)}</th>${cells}</tr>`;
    })
    .join('');
  return (
    `<table class="mc-wp"><caption class="visually-hidden">Win probability of each option${both ? ', experimental model and nfl4th' : ''}</caption>` +
    `<thead>${head}</thead><tbody>${body}</tbody></table>`
  );
}

/** Both calls and each option's WP, experimental first; a disagreement says so in words and with the slate bar. */
export function comparisonHtml(view: ComparisonView): string {
  if (view.kind === 'unsupported') return `<div class="mc"><p class="mc-unsupported">${escape(view.message)}</p></div>`;
  if (view.kind === 'nfl4th-only') {
    return (
      `<div class="mc"><div class="mc-calls">${callBox("nfl4th's recommendation", view.nfl4th, 'mc-call')}</div>` +
      `<p class="mc-unsupported">${escape(view.message)}</p>${wpTable(view.options, false)}</div>`
    );
  }
  const notes = view.notes.map((n) => `<p class="mc-note">${escape(n)}</p>`).join('');
  return (
    `<div class="mc${view.disagree ? ' disagree' : ''}">` +
    (view.disagree ? '<p class="mc-flag">The models disagree</p>' : '<p class="mc-agree">The models agree</p>') +
    `<div class="mc-calls">${callBox('Experimental model', view.experimental, 'mc-call mc-experimental')}` +
    `${callBox("nfl4th's recommendation", view.nfl4th, 'mc-call')}</div>` +
    `${wpTable(view.options, true)}` +
    `<p class="mc-label">${escape(view.label)} ${escape(view.asOf)}</p>${notes}</div>`
  );
}

/** The experimental model's adjustments to each option, from nfl4th's WP to its own, in WP points. */
export function breakdownHtml(b: BreakdownView): string {
  const cols = b.columns.map((c) => `<th scope="col">${escape(c.label)}</th>`).join('');
  const row = (label: string, cells: string[], className = '') =>
    `<tr${className ? ` class="${className}"` : ''}><th scope="row">${escape(label)}</th>${cells.join('')}</tr>`;
  const plain = (values: string[]) => values.map((v) => `<td>${escape(v)}</td>`);
  const terms = b.terms.map((t) =>
    row(
      t.label,
      t.cells.map((c) =>
        c.value === '' ? '<td><span class="visually-hidden">Not this option</span></td>' : `<td${c.muted ? ' class="muted"' : ''}>${escape(c.value)}</td>`,
      ),
    ),
  );
  const changed = b.changed.length ? `<ul class="mc-changed">${b.changed.map((c) => `<li>${escape(c)}</li>`).join('')}</ul>` : '';
  return (
    '<div class="mc-breakdown"><table class="mc-terms">' +
    '<caption>Experimental adjustments, in points of win probability</caption>' +
    `<thead><tr><th scope="col">Term</th>${cols}</tr></thead><tbody>` +
    row('nfl4th win prob.', plain(b.start), 'mc-total') +
    terms.join('') +
    row('Residual (terms interact)', plain(b.residual)) +
    row('Experimental win prob.', plain(b.end), 'mc-total') +
    `</tbody></table>${changed}</div>`
  );
}
