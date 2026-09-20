/**
 * The ticker's week as a label. nflverse numbers postseason rounds as
 * weeks 19 to 22, which read as round names rather than week numbers.
 */
const postseasonRounds: Record<number, string> = {
  19: 'Wild card',
  20: 'Divisional',
  21: 'Conference',
  22: 'Super Bowl',
};

/** Null in the offseason, when there is no week on display. */
export function weekLabel(week: number | null): string | null {
  if (week == null) return null;
  return postseasonRounds[week] ?? `Week ${week}`;
}
