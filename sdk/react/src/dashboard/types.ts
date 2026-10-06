import type { AgentRunSummary } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/io_pb";
import type { GetOrgUsageReportOutput } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/io_pb";
import type { RunSummary } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/io_pb";

/**
 * Unified dashboard summary combining operational metrics from both
 * agent and workflow run domains.
 *
 * Run counts (active, completed, failed) are safe to add because
 * agent runs and workflow runs are distinct resources.
 *
 * Cost comes from {@link GetOrgUsageReportOutput} (billing source of truth),
 * NOT from summing agent + workflow costs. This prevents double-counting
 * when workflows delegate to agents. See AD-DASH-005.
 */
export interface DashboardSummary {
  /** Combined agent + workflow active run count. */
  readonly activeCount: number;
  /** Combined agent + workflow completed count. */
  readonly completedCount: number;
  /** Combined agent + workflow failed count. */
  readonly failedCount: number;
  /**
   * Total platform cost in USD from the billing source of truth.
   * Sourced from `getOrgUsageReport.total_billable_cost_micros`.
   */
  readonly totalCostUsd: number;
  /** Agent-side run summary for per-source breakdown in tooltips. */
  readonly agent: AgentRunSummary | null;
  /** Workflow-side run summary for per-source breakdown in tooltips. */
  readonly workflow: RunSummary | null;
  /** Org-level usage report for cost details. */
  readonly orgUsage: GetOrgUsageReportOutput | null;
}

/** A normalized entry representing a failed run from either domain. */
export interface DashboardFailedRun {
  /** Run ID (`aex_*` or `wex_*`). */
  readonly id: string;
  /** Discriminator for routing navigation. */
  readonly type: "agent_run" | "workflow_run";
  /** Run name or subject. */
  readonly name: string;
  /** Error message from the failed run. */
  readonly error: string;
  /** When the run failed. */
  readonly failedAt: Date;
  /** The agent or workflow name associated with this run. */
  readonly resourceName: string;
}
