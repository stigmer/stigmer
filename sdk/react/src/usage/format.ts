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

/** Whole-number share of a total as a percentage, 0 when the total is 0. */
export function sharePercent(part: number | bigint, total: number | bigint): number {
  const t = Number(total);
  return t > 0 ? Math.round((Number(part) / t) * 100) : 0;
}
