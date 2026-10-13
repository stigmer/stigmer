"use client";

/**
 * Dashboard summary composition: the run summary's counts and the org
 * usage report's token total over the last seven days, as one
 * {@link DashboardSummary}. The suite in
 * `__tests__/useDashboardSummary.test.tsx` pins the organization each
 * source is asked for, the loading gate and the token total.
 */

import { useMemo } from "react";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { useOrgUsageReport } from "../usage/useOrgUsageReport.js";
import { dateRangeFromPreset } from "../usage/date-range.js";
import {
  useRunSummary,
  RunSummaryTimeWindow,
} from "./useRunSummary.js";
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
 * Composition hook that merges the run summary and the org usage
 * report into a single {@link DashboardSummary}.
 *
 * - Run counts (active, completed, failed) come from the run
 *   summary over the last seven days.
 * - Tokens come from `getOrgUsageReport` (`total_usage.total_tokens`),
 *   which counts each run once, so the dashboard and the Usage page show
 *   the same number for the same window.
 */
export function useDashboardSummary(
  options: UseDashboardSummaryOptions,
): UseDashboardSummaryReturn {
  const refetchInterval = options.refetchInterval ?? 60_000;

  const { summary: agentSummary, isLoading: agLoading, error: agError, refetch: agRefetch } =
    useRunSummary({
      org: options.org,
      timeWindow: RunSummaryTimeWindow.LAST_7D,
      refetchInterval,
    });

  const dateRange = useMemo(() => dateRangeFromPreset("7d"), []);
  const { report: orgUsage, isLoading: usageLoading, error: usageError, refetch: usageRefetch } =
    useOrgUsageReport(options.org ?? null, dateRange);

  const isLoading = agLoading || usageLoading;
  const error = agError ?? usageError;

  const summary = useMemo<DashboardSummary | null>(() => {
    if (isLoading && !agentSummary) return null;

    const totalTokens = Number(orgUsage?.totalUsage?.totalTokens ?? BigInt(0));

    return {
      activeCount: agentSummary?.activeCount ?? 0,
      completedCount: agentSummary?.phaseCounts[RunPhase.RUN_COMPLETED] ?? 0,
      failedCount: agentSummary?.phaseCounts[RunPhase.RUN_FAILED] ?? 0,
      totalTokens,
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
