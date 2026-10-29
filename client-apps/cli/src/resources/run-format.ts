// Shared, presentation-only formatters for run output.
//
// Duration math, ellipsis truncation, and the compact token count the usage
// reports and the run epilogue share. They live here, away from any RPC code,
// so run output formats durations, tokens and truncated text the same way
// everywhere.

/**
 * Human duration between two ISO 8601 timestamps:
 * "-" when either bound is missing/unparseable, "<n>s" under a minute,
 * "<m>m <s>s" under an hour, "<h>h <m>m" otherwise.
 */
export function calculateDuration(start: string, end: string): string {
  if (start === "" || end === "") return "-";
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return "-";

  const totalSeconds = Math.floor((endMs - startMs) / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  if (totalSeconds < 3600) return `${Math.floor(totalSeconds / 60)}m ${totalSeconds % 60}s`;
  return `${Math.floor(totalSeconds / 3600)}h ${Math.floor((totalSeconds % 3600) / 60)}m`;
}

/** Truncate to `maxLen`, appending "..." when cut. */
export function truncateWithEllipsis(value: string, maxLen: number): string {
  if (value.length <= maxLen) return value;
  if (maxLen <= 3) return value.slice(0, maxLen);
  return `${value.slice(0, maxLen - 3)}...`;
}

/**
 * Compact token count: the integer under a thousand, then one decimal with a
 * "k" or "M" suffix ("18.4k", "1.2M"). Takes the wire's int64 as is; display
 * precision makes the Number conversion harmless past 2^53.
 */
export function formatTokenCount(count: bigint): string {
  const n = Number(count);
  if (n < 1000) return String(count);
  // 999,950 and up would round to "1000.0k"; it reads as "1.0M" instead.
  if (n < 999_950) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}
