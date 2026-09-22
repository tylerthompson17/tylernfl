/**
 * Kickoff time in the visitor's own time zone and locale, e.g. "Sun 1:00 PM".
 * `locale` and `timeZone` are for tests; the browser defaults are used on the site.
 */
export function formatKickoff(iso: string, locale?: string, timeZone?: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale, { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone })
    .format(date)
    .replace(/\s/g, ' ');
}

/**
 * A kickoff with its date, in the visitor's time zone: "Sun, Sep 27, 1:00 PM",
 * or with style "date" just "Sun, Sep 27". For team schedules and the next
 * game, which are further off than a weekday alone can place.
 */
export function formatKickoffDate(
  iso: string,
  style: 'date' | 'datetime' = 'datetime',
  locale?: string,
  timeZone?: string
): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const options: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric', timeZone };
  if (style === 'datetime') Object.assign(options, { hour: 'numeric', minute: '2-digit' });
  return new Intl.DateTimeFormat(locale, options).format(date).replace(/\s/g, ' ');
}
