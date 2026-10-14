/**
 * Compact count formatting shared by every usage view (organization panel,
 * agent and harness breakdowns, session widget, dashboard KPI).
 *
 * Usage is shown as token and call counts, never as money, so one formatter
 * keeps "18.4k tokens" reading the same on every surface, and the CLI's
 * `formatTokenCount` (`client-apps/cli/src/resources/run-format.ts`) uses the
 * same thresholds and suffixes. Counts arrive as the wire's int64 (`bigint`)
 * or as plain numbers; display precision makes the Number conversion
 * harmless past 2^53. The suite in `__tests__/format.test.ts` pins the
 * thresholds, including the rounding edges that would otherwise read
 * "1000.0k".
 *
 * Working time is a clock, so it reads as a duration in hours and minutes,
 * never days and never tenths of an hour ("312h 5m", "4m 12s"): a turn is
 * minutes, and a month of work stays comparable across agents in one unit.
 * The CLI's `formatWorkingTime` (`client-apps/cli/src/resources/usage.ts`)
 * prints the same.
 */

/**
 * Compact count: the integer under a thousand, then one decimal with a "k",
 * "M" or "B" suffix ("847", "18.4k", "1.2M", "3.0B").
 */
export function formatCompactCount(count: number | bigint): string {
  const n = Number(count);
  if (n < 1000) return String(Math.round(n));
  // 999,950 and up would round to "1000.0k"; it reads as the next unit.
  if (n < 999_950) return `${(n / 1000).toFixed(1)}k`;
  if (n < 999_950_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return `${(n / 1_000_000_000).toFixed(1)}B`;
}

/** Compact token count with its unit: "1 token", "847 tokens", "18.4k tokens". */
export function formatTokens(count: number | bigint): string {
  return `${formatCompactCount(count)} ${Number(count) === 1 ? "token" : "tokens"}`;
}

/** Call count with its unit: "1 call", "42 calls", "1.2k calls". */
export function formatCalls(count: number): string {
  return `${formatCompactCount(count)} ${count === 1 ? "call" : "calls"}`;
}

/** Working time as a duration: "0s", "45s", "4m 12s", "312h 5m"; never days. */
export function formatWorkingTime(seconds: number | bigint): string {
  const total = Math.max(0, Math.floor(Number(seconds)));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${total % 60}s`;
  return `${total}s`;
}

/** Whole-number share of a total as a percentage, 0 when the total is 0. */
export function sharePercent(part: number | bigint, total: number | bigint): number {
  const t = Number(total);
  return t > 0 ? Math.round((Number(part) / t) * 100) : 0;
}
