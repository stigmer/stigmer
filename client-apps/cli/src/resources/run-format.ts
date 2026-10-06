// Shared, presentation-only formatters for run output.
//
// These mirror helpers in Go's pkg/display + internal/cli/execution (duration
// math, ellipsis truncation). They live here, away from any RPC code, so run
// output formats durations and truncates text the same way everywhere.

/**
 * Human duration between two ISO 8601 timestamps. Mirrors Go's calculateDuration:
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

/** Truncate to `maxLen`, appending "..." when cut. Mirrors Go's display.TruncateWithEllipsis. */
export function truncateWithEllipsis(value: string, maxLen: number): string {
  if (value.length <= maxLen) return value;
  if (maxLen <= 3) return value.slice(0, maxLen);
  return `${value.slice(0, maxLen - 3)}...`;
}
