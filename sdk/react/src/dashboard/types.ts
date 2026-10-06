import type { GetOrgUsageReportOutput } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/io_pb";

/**
 * Dashboard summary of an organization's agent runs.
 *
 * Run counts (active, completed, failed) come from the agent run summary.
 * Cost comes from {@link GetOrgUsageReportOutput} (billing source of truth),
 * not from summing per-run costs. See AD-DASH-005.
 */
export interface DashboardSummary {
  /** Active agent run count. */
  readonly activeCount: number;
  /** Completed agent run count. */
  readonly completedCount: number;
  /** Failed agent run count. */
  readonly failedCount: number;
  /**
   * Total platform cost in USD from the billing source of truth.
   * Sourced from `getOrgUsageReport.total_billable_cost_micros`.
   */
  readonly totalCostUsd: number;
  /** Org-level usage report for cost details. */
  readonly orgUsage: GetOrgUsageReportOutput | null;
}

/** A normalized entry representing a failed agent run. */
export interface DashboardFailedRun {
  /** Agent run ID (`aex_*`). */
  readonly id: string;
  /** Run name or subject. */
  readonly name: string;
  /** Error message from the failed run. */
  readonly error: string;
  /** When the run failed. */
  readonly failedAt: Date;
  /** The agent the run ran. */
  readonly resourceName: string;
}
