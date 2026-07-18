import type { RecentActivityEntry } from "./types.js";

/**
 * A tiny status annotation for a recents row, or `null` when the row
 * should stay clean.
 *
 * Only NOTEWORTHY execution states earn a badge: a completed run is the
 * expected outcome (annotating every row would be noise), and sessions
 * carry no phase at all. Paired with the relative-time stamp, the badge
 * explains why an old-named execution sits high in a last-activity-sorted
 * list ("failed · 2h" — it just failed, that's the activity).
 */
export interface RecentActivityStatusBadge {
  /** Lowercase phase word, rendered verbatim (e.g. "failed"). */
  readonly label: string;
  /** Rendering tone: `"destructive"` for terminal failures, else `"muted"`. */
  readonly tone: "destructive" | "muted";
}

const BADGED_STATUSES: ReadonlyMap<string, RecentActivityStatusBadge["tone"]> =
  new Map([
    ["failed", "destructive"],
    ["terminated", "destructive"],
    ["cancelled", "muted"],
    ["running", "muted"],
    ["pending", "muted"],
  ]);

/**
 * Resolves the status badge for a recent-activity entry. Returns `null`
 * for sessions, completed executions, and unknown phases.
 */
export function recentActivityStatusBadge(
  entry: RecentActivityEntry,
): RecentActivityStatusBadge | null {
  if (entry.type !== "workflow_execution" || !entry.status) return null;
  const tone = BADGED_STATUSES.get(entry.status);
  return tone ? { label: entry.status, tone } : null;
}
