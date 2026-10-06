"use client";

import { useMemo } from "react";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/enum_pb";
import { useOrgUsageReport } from "../usage/useOrgUsageReport.js";
import { dateRangeFromPreset } from "../usage/date-range.js";
import {
  useAgentRunSummary,
  AgentRunSummaryTimeWindow,
} from "./useAgentRunSummary.js";
import type { DashboardSummary } from "./types.js";

/** Options for {@link useDashboardSummary}. */
export interface UseDashboardSummaryOptions {
  /** The organization whose run summary and usage report to read. */
  readonly org: string | null | undefined;
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
 * Composition hook that merges the agent run summary and the org usage
 * report into a single {@link DashboardSummary}.
 *
 * - Run counts (active, completed, failed) come from the agent run
 *   summary over the last seven days.
 * - Cost comes from `getOrgUsageReport` (billing source of truth), not
 *   from summing per-run costs. See AD-DASH-005.
 */
export function useDashboardSummary(
  options: UseDashboardSummaryOptions,
): UseDashboardSummaryReturn {
  const refetchInterval = options.refetchInterval ?? 60_000;

  const { summary: agentSummary, isLoading: agLoading, error: agError, refetch: agRefetch } =
    useAgentRunSummary({
      org: options.org,
      timeWindow: AgentRunSummaryTimeWindow.LAST_7D,
      refetchInterval,
    });

  const dateRange = useMemo(() => dateRangeFromPreset("7d"), []);
  const { report: orgUsage, isLoading: usageLoading, error: usageError, refetch: usageRefetch } =
    useOrgUsageReport(options.org ?? null, dateRange);

  const isLoading = agLoading || usageLoading;
  const error = agError ?? usageError;

  const summary = useMemo<DashboardSummary | null>(() => {
    if (isLoading && !agentSummary) return null;

    const totalCostMicros = Number(orgUsage?.totalBillableCostMicros ?? BigInt(0));
    const totalCostUsd = totalCostMicros / 1_000_000;

    return {
      activeCount: agentSummary?.activeCount ?? 0,
      completedCount: agentSummary?.phaseCounts[RunPhase.RUN_COMPLETED] ?? 0,
      failedCount: agentSummary?.phaseCounts[RunPhase.RUN_FAILED] ?? 0,
      totalCostUsd,
      orgUsage: orgUsage,
    };
  }, [agentSummary, orgUsage, isLoading]);

  const refetch = useMemo(() => {
    return () => {
      agRefetch();
      usageRefetch();
    };
  }, [agRefetch, usageRefetch]);

  return { summary, isLoading, error, refetch };
}
