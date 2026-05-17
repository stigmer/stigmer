/** Discriminator for items in the unified recents list. */
export type RecentActivityType = "session" | "workflow_execution";

/**
 * A normalized entry representing either an agent session or a workflow
 * execution. Used by {@link useRecentActivity} and rendered in the sidebar
 * recents section.
 */
export interface RecentActivityEntry {
  /** Resource ID (session ID or workflow execution ID). */
  readonly id: string;
  /** Discriminator — determines which viewer to open on click. */
  readonly type: RecentActivityType;
  /** Human-readable label: session subject or workflow execution name. */
  readonly subject: string;
  /**
   * Last meaningful update timestamp, used for interleaved sort.
   * For sessions: `status.audit.specAudit.createdAt`.
   * For workflow executions: `status.audit.specAudit.createdAt`.
   */
  readonly updatedAt: Date;
  /**
   * Execution phase for workflow executions (e.g. "COMPLETED", "FAILED").
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
