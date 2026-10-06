/**
 * A normalized recent session, as listed by {@link useRecentActivity}
 * and rendered in the sidebar recents section.
 */
export interface RecentActivityEntry {
  /** Session ID. */
  readonly id: string;
  /** Human-readable label: the session subject. */
  readonly subject: string;
  /**
   * Last meaningful update timestamp, used for the recency sort.
   * Derived from `status.audit.statusAudit.updatedAt` (bumped on every
   * meaningful status change), with fallback to `specAudit.createdAt`
   * for sessions that have never been independently updated.
   */
  readonly updatedAt: Date;
}

/** A time-based group of recent activity entries. */
export interface RecentActivityGroup {
  /** Display label (e.g. "Today", "Yesterday"). */
  readonly label: string;
  /** Entries in this group, sorted by `updatedAt` descending. */
  readonly entries: readonly RecentActivityEntry[];
}
