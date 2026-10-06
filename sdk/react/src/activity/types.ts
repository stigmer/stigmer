/** Discriminator for items in the unified recents list. */
export type RecentActivityType = "session" | "workflow_run";

/**
 * A normalized entry representing either an agent session or a workflow
 * run. Used by {@link useRecentActivity} and rendered in the sidebar
 * recents section.
 */
export interface RecentActivityEntry {
  /** Resource ID (session ID or workflow run ID). */
  readonly id: string;
  /** Discriminator — determines which viewer to open on click. */
  readonly type: RecentActivityType;
  /** Human-readable label: session subject or workflow run name. */
  readonly subject: string;
  /**
   * Last meaningful update timestamp, used for interleaved sort.
   * Derived from `status.audit.statusAudit.updatedAt` (bumped on every
   * meaningful status change), with fallback to `specAudit.createdAt`
   * for resources that have never been independently updated.
   */
  readonly updatedAt: Date;
  /**
   * Run phase for workflow runs (e.g. "COMPLETED", "FAILED").
   * `undefined` for sessions.
   */
  readonly status?: string;
}

/** A time-based group of recent activity entries. */
export interface RecentActivityGroup {
  /** Display label (e.g. "Today", "Yesterday"). */
  readonly label: string;
  /** Entries in this group, sorted by `updatedAt` descending. */
  readonly entries: readonly RecentActivityEntry[];
}
