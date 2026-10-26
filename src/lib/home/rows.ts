/**
 * How many rows a home page list shows at each width, so the page's two
 * columns end together. The main column ends with a list that takes up the
 * slack: below 1100px its chart is shorter, so it shows more rows there; on
 * phones there is one column, nothing to balance, so lists are short.
 *
 * Every row is in the HTML; src/styles/home.css hides the ones past each
 * width's count (classes `rows w8 m12 p8`), and `moreCounts` gives the
 * "N more" a foot shows at each width.
 */
export interface Rows {
  /** 1101px and wider: two columns, main 2 to sidebar 1 */
  wide: number;
  /** 761 to 1100px: the same two columns, the chart shorter */
  mid: number;
  /** 760px and narrower: one column */
  phone: number;
}

/** The most rows any width shows: how many to render. */
export const rendered = (r: Rows): number => Math.max(r.wide, r.mid, r.phone);

/** The class list for the list or table's wrapper. */
export const rowsClass = (r: Rows): string => `rows w${r.wide} m${r.mid} p${r.phone}`;

/**
 * How many are left out at each width: `listed` is how many the list has
 * (at most `rendered`), `total` how many there are in all, on the full page.
 */
export function moreCounts(r: Rows, listed: number, total: number): Rows {
  const more = (shown: number) => Math.max(0, total - Math.min(shown, listed));
  return { wide: more(r.wide), mid: more(r.mid), phone: more(r.phone) };
}

/** The same count at every width. */
export const allWidths = (n: number): Rows => ({ wide: n, mid: n, phone: n });

/** The largest count the stylesheet has rules for. */
export const MAX_ROWS = 24;
