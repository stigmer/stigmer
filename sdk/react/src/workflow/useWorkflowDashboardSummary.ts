"use client";

import { create } from "@bufbuild/protobuf";
import type { ExecutionSummary } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/io_pb";
import {
  GetExecutionSummaryRequestSchema,
  SummaryTimeWindow,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/io_pb";
import { useStigmer } from "../hooks";
import { useFetch } from "../internal/useFetch";

export type { SummaryTimeWindow };

export interface UseWorkflowDashboardSummaryOptions {
  /** Organization slug. When empty, the hook does not fetch. */
  readonly org: string | null | undefined;
  /** Time window for aggregation. @default SUMMARY_TIME_WINDOW_LAST_7D */
  readonly timeWindow?: SummaryTimeWindow;
  /** Refetch interval in milliseconds. `0` or `false` disables. @default 0 */
  readonly refetchInterval?: number | false;
}

export interface UseWorkflowDashboardSummaryReturn {
  readonly summary: ExecutionSummary | null;
  readonly isLoading: boolean;
  readonly isRefetching: boolean;
  readonly error: Error | null;
  readonly refetch: () => void;
}

/**
 * Data hook that fetches aggregated execution statistics for an organization.
 *
 * Returns phase counts, cost totals, average duration, top failing workflows,
 * and per-workflow cost breakdowns — scoped to a configurable time window.
 *
 * @example
 * ```tsx
 * const { summary, isLoading } = useWorkflowDashboardSummary({
 *   org: "acme",
 *   timeWindow: SummaryTimeWindow.SUMMARY_TIME_WINDOW_LAST_7D,
 * });
 * ```
 */
export function useWorkflowDashboardSummary(
  options: UseWorkflowDashboardSummaryOptions,
): UseWorkflowDashboardSummaryReturn {
  const stigmer = useStigmer();
  const org = options.org ?? "";
  const timeWindow =
    options.timeWindow ?? SummaryTimeWindow.LAST_7D;
  const refetchInterval = options.refetchInterval ?? 0;

  const fetchFn = org
    ? async () => {
        return await stigmer.workflowExecution.getExecutionSummary(
          create(GetExecutionSummaryRequestSchema, { org, timeWindow }),
        );
      }
    : null;

  const { data, isLoading, isRefetching, error, refetch } =
    useFetch<ExecutionSummary | null>(
      fetchFn,
      [stigmer, org, timeWindow],
      null,
      { refetchInterval: refetchInterval || false },
    );

  return { summary: data, isLoading, isRefetching, error, refetch };
}
