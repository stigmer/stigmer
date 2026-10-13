/**
 * Date range presets and utilities for usage report queries.
 *
 * Presets are 7-, 14- and 30-day windows ending today. Both ends are sent
 * as date-only YYYY-MM-DD strings, which the usage reports read as UTC
 * calendar days: `from` from its first instant, `to` through its last, a
 * run counting when it was created in the range. The days are therefore
 * computed in UTC too, so "today" always includes the newest runs and the
 * range lines up with the report's UTC daily rows; a local date would end
 * the range early for anyone west of UTC late in their day. The suite in
 * `__tests__/date-range.test.ts` pins the UTC anchoring and the window
 * length.
 */

/** A closed date range where both ends are UTC calendar days (YYYY-MM-DD). */
export interface DateRange {
  /** Start day (inclusive, from its first instant) in YYYY-MM-DD format. */
  readonly from: string;
  /** End day (inclusive, through its last instant) in YYYY-MM-DD format. */
  readonly to: string;
}

/** Supported preset window sizes for usage reports. */
export type DateRangePreset = "7d" | "14d" | "30d";

/** All available presets in display order. */
export const DATE_RANGE_PRESETS: readonly DateRangePreset[] = [
  "7d",
  "14d",
  "30d",
];

/** Human-readable label for each preset. */
export function presetLabel(preset: DateRangePreset): string {
  switch (preset) {
    case "7d":
      return "7 days";
    case "14d":
      return "14 days";
    case "30d":
      return "30 days";
  }
}

/**
 * Compute a {@link DateRange} from a preset, anchored to today in UTC.
 *
 * The `to` day is always today's UTC date (inclusive). The `from` day is
 * `days - 1` calendar days before it so the range contains exactly `days`
 * calendar days.
 *
 * @param now - The instant "today" is taken from; defaults to the clock.
 */
export function dateRangeFromPreset(
  preset: DateRangePreset,
  now: Date = new Date(),
): DateRange {
  const days = Number.parseInt(preset, 10);
  const from = new Date(now);
  from.setUTCDate(from.getUTCDate() - (days - 1));

  return {
    from: formatUtcDate(from),
    to: formatUtcDate(now),
  };
}

/** Format a `Date` as its UTC calendar day, YYYY-MM-DD. */
function formatUtcDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Format a date range for display (e.g. "Mar 30 -- Apr 06").
 *
 * Uses short month names and zero-padded days for a compact, scannable
 * representation in the date-range selector.
 */
export function formatDateRange(range: DateRange): string {
  const from = parseLocalDate(range.from);
  const to = parseLocalDate(range.to);
  const fmt = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
  });
  return `${fmt.format(from)} \u2013 ${fmt.format(to)}`;
}

/**
 * Parse a YYYY-MM-DD day into a local Date with the same calendar fields,
 * so formatting shows the day as written rather than shifting it by the
 * viewer's offset.
 */
function parseLocalDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}
