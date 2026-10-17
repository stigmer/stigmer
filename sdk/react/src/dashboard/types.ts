/**
 * Shapes the operational dashboard renders: the organization's run counts
 * and token total, and its recent failed runs. Usage is tokens, never
 * money; the KPI and summary suites pin how these fields are filled and
 * shown.
 */

import type { GetOrgUsageReportOutput } from "@stigmer/apis/ai/stigmer/agentic/run/v1/io_pb";

/**
 * Dashboard summary of an organization's runs.
 *
 * Run counts (active, completed, failed) come from the run summary.
 * Tokens come from the org usage report ({@link GetOrgUsageReportOutput}),
 * which counts each run once, so the dashboard and the Usage page agree.
 */
export interface DashboardSummary {
  /** Active run count. */
  readonly activeCount: number;
  /** Completed run count. */
  readonly completedCount: number;
  /** Failed run count. */
  readonly failedCount: number;
  /**
   * The organization's total tokens over the dashboard's window, from
   * `getOrgUsageReport.total_usage.total_tokens`.
   */
  readonly totalTokens: number;
  /** Org-level usage report for token details. */
  readonly orgUsage: GetOrgUsageReportOutput | null;
}

/** A normalized entry representing a failed run. */
export interface DashboardFailedRun {
  /** Run ID (`run_*`). */
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
