import type { Timestamp } from "@bufbuild/protobuf/wkt";

/**
 * Convert a protobuf Timestamp to a JS Date.
 * Returns null if the timestamp is undefined or has no seconds.
 */
export function toDate(ts: Timestamp | undefined): Date | null {
  if (!ts) return null;
  const seconds = Number(ts.seconds);
  if (!seconds && seconds !== 0) return null;
  return new Date(seconds * 1000 + Math.floor(ts.nanos / 1_000_000));
}

/**
 * Format a protobuf Timestamp as a human-readable relative time string.
 *
 * Examples: "just now", "2m ago", "3h ago", "yesterday", "Mar 12"
 */
export function formatRelativeTime(ts: Timestamp | undefined): string {
  const date = toDate(ts);
  if (!date) return "";

  const now = Date.now();
  const diffMs = now - date.getTime();

  if (diffMs < 0) return "just now";
  if (diffMs < 60_000) return "just now";

  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;

  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
