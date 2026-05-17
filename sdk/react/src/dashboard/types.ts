import type { AgentExecutionSummary } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import type { GetOrgUsageReportOutput } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import type { ExecutionSummary } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/io_pb";

/**
 * Unified dashboard summary combining operational metrics from both
 * agent and workflow execution domains.
 *
 * Execution counts (active, completed, failed) are safe to add because
 * agent executions and workflow executions are distinct resources.
 *
 * Cost comes from {@link GetOrgUsageReportOutput} (billing source of truth),
 * NOT from summing agent + workflow costs. This prevents double-counting
 * when workflows delegate to agents. See AD-DASH-005.
 */
export interface DashboardSummary {
  /** Combined agent + workflow active execution count. */
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
  /** Agent-side execution summary for per-source breakdown in tooltips. */
  readonly agent: AgentExecutionSummary | null;
  /** Workflow-side execution summary for per-source breakdown in tooltips. */
  readonly workflow: ExecutionSummary | null;
  /** Org-level usage report for cost details. */
  readonly orgUsage: GetOrgUsageReportOutput | null;
}

/** A normalized entry representing a failed execution from either domain. */
export interface DashboardFailedRun {
  /** Execution ID (`aex_*` or `wex_*`). */
  readonly id: string;
  /** Discriminator for routing navigation. */
  readonly type: "agent_execution" | "workflow_execution";
  /** Execution name or subject. */
  readonly name: string;
  /** Error message from the failed execution. */
  readonly error: string;
  /** When the execution failed. */
  readonly failedAt: Date;
  /** The agent or workflow name associated with this execution. */
  readonly resourceName: string;
}
