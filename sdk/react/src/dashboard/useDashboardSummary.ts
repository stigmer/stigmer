"use client";

import { useMemo } from "react";
import { ExecutionPhase as WorkflowPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import { ExecutionPhase as AgentPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import {
  useWorkflowDashboardSummary,
  type UseWorkflowDashboardSummaryOptions,
} from "../workflow/useWorkflowDashboardSummary.js";
import { useOrgUsageReport } from "../usage/useOrgUsageReport.js";
import { dateRangeFromPreset } from "../usage/date-range.js";
import {
  useAgentExecutionSummary,
  AgentExecutionSummaryTimeWindow,
} from "./useAgentExecutionSummary.js";
import type { DashboardSummary } from "./types.js";

/** Options for {@link useDashboardSummary}. */
export interface UseDashboardSummaryOptions {
  /** Organization slug for execution summaries. */
  readonly org: string | null | undefined;
  /** Organization ID (metadata.id) for the usage report. */
  readonly orgId: string | null | undefined;
  /** Refetch interval in milliseconds. @default 60_000 */
  readonly refetchInterval?: number;
}

/** Return value of {@link useDashboardSummary}. */
export interface UseDashboardSummaryReturn {
  readonly summary: DashboardSummary | null;
  readonly isLoading: boolean;
  readonly error: Error | null;
  readonly refetch: () => void;
}

/**
 * Composition hook that merges agent execution summary, workflow execution
 * summary, and org usage report into a single {@link DashboardSummary}.
 *
 * - Execution counts (active, completed, failed) are added across both
 *   domains — safe because agent and workflow executions are distinct resources.
 * - Cost comes from `getOrgUsageReport` (billing source of truth). NOT from
 *   summing agent + workflow costs. See AD-DASH-005.
 *
 * Follows the same client-side merge pattern as `useRecentActivity`.
 *
 * @since Unified Platform Dashboard
 */
export function useDashboardSummary(
  options: UseDashboardSummaryOptions,
): UseDashboardSummaryReturn {
  const refetchInterval = options.refetchInterval ?? 60_000;

  const { summary: workflowSummary, isLoading: wfLoading, error: wfError, refetch: wfRefetch } =
    useWorkflowDashboardSummary({
      org: options.org,
      refetchInterval,
    } satisfies UseWorkflowDashboardSummaryOptions);

  const { summary: agentSummary, isLoading: agLoading, error: agError, refetch: agRefetch } =
    useAgentExecutionSummary({
      org: options.org,
      timeWindow: AgentExecutionSummaryTimeWindow.LAST_7D,
      refetchInterval,
    });

  const dateRange = useMemo(() => dateRangeFromPreset("7d"), []);
  const { report: orgUsage, isLoading: usageLoading, error: usageError, refetch: usageRefetch } =
    useOrgUsageReport(options.orgId ?? null, dateRange);

  const isLoading = wfLoading || agLoading || usageLoading;
  const error = wfError ?? agError ?? usageError;

  const summary = useMemo<DashboardSummary | null>(() => {
    if (isLoading && !workflowSummary && !agentSummary) return null;

    const wfActive = workflowSummary?.activeCount ?? 0;
    const agActive = agentSummary?.activeCount ?? 0;

    const wfCompleted = workflowSummary?.phaseCounts[WorkflowPhase.EXECUTION_COMPLETED] ?? 0;
    const agCompleted = agentSummary?.phaseCounts[AgentPhase.EXECUTION_COMPLETED] ?? 0;

    const wfFailed = workflowSummary?.phaseCounts[WorkflowPhase.EXECUTION_FAILED] ?? 0;
    const agFailed = agentSummary?.phaseCounts[AgentPhase.EXECUTION_FAILED] ?? 0;

    const totalCostMicros = Number(orgUsage?.totalBillableCostMicros ?? BigInt(0));
    const totalCostUsd = totalCostMicros / 1_000_000;

    return {
      activeCount: wfActive + agActive,
      completedCount: wfCompleted + agCompleted,
      failedCount: wfFailed + agFailed,
      totalCostUsd,
      agent: agentSummary,
      workflow: workflowSummary,
      orgUsage: orgUsage,
    };
  }, [workflowSummary, agentSummary, orgUsage, isLoading]);

  const refetch = useMemo(() => {
    return () => {
      wfRefetch();
      agRefetch();
      usageRefetch();
    };
  }, [wfRefetch, agRefetch, usageRefetch]);

  return { summary, isLoading, error, refetch };
}
