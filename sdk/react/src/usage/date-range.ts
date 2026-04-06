/**
 * Date range presets and utilities for usage report queries.
 *
 * Preset values match common billing-dashboard patterns (7-day, 14-day,
 * 30-day windows). All dates are formatted as YYYY-MM-DD strings to
 * align with the `GetOrgUsageReportInput` proto contract.
 */

/** A closed date range where both ends are ISO date strings (YYYY-MM-DD). */
export interface DateRange {
  readonly from: string;
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
 * Compute a {@link DateRange} from a preset, anchored to today.
 *
 * The `to` date is always today (inclusive). The `from` date is
 * `days - 1` calendar days before today so the range contains exactly
 * `days` calendar days.
 */
export function dateRangeFromPreset(preset: DateRangePreset): DateRange {
  const days = Number.parseInt(preset, 10);
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - (days - 1));

  return {
    from: formatDate(from),
    to: formatDate(to),
  };
}

/** Format a `Date` as a YYYY-MM-DD string in local time. */
function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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

/** Parse a YYYY-MM-DD string into a local Date (avoids timezone shift). */
function parseLocalDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}
