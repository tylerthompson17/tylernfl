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
