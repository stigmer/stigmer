"use client";

import { create } from "@bufbuild/protobuf";
import {
  GetOrgUsageReportInputSchema,
  type GetOrgUsageReportOutput,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import type { ModelUsage } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/usage_pb";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";
import type { DateRange } from "./date-range.js";

/**
 * Lightweight summary of an agent's usage within an org report.
 *
 * Re-exported as a plain interface so consumers don't need to depend
 * on `@stigmer/protos` directly for type-safe rendering.
 */
export type { ModelUsage };

/** Return value of {@link useOrgUsageReport}. */
export interface UseOrgUsageReportReturn {
  /** The raw report from the server, or `null` before the first successful fetch. */
  readonly report: GetOrgUsageReportOutput | null;
  /** `true` while a fetch is in flight. */
  readonly isLoading: boolean;
  /** `true` while a background refetch is in flight and stale data is shown. */
  readonly isRefetching: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch from the server. */
  readonly refetch: () => void;
}

/**
 * Data hook that fetches the organization-level usage report.
 *
 * Calls `stigmer.agentExecution.getOrgUsageReport` with the provided
 * org ID and date range. The server returns aggregated totals, a
 * per-model breakdown, the top agents by cost, and a daily cost trend.
 *
 * Pass `null` as `orgId` to skip fetching (stable no-op). Call
 * `refetch()` to re-query manually.
 *
 * @param orgId - Organization ID, or `null` to skip.
 * @param dateRange - Closed date range (YYYY-MM-DD strings).
 *
 * @example
 * ```tsx
 * const range = dateRangeFromPreset("30d");
 * const { report, isLoading, error } = useOrgUsageReport(orgId, range);
 *
 * if (isLoading) return <Skeleton />;
 * if (error) return <ErrorMessage error={error} />;
 * if (!report) return null;
 *
 * const costUsd = Number(report.totalBillableCostMicros) / 1_000_000;
 * return <div>Total cost: {formatCost(costUsd)}</div>;
 * ```
 */
export function useOrgUsageReport(
  orgId: string | null,
  dateRange: DateRange,
): UseOrgUsageReportReturn {
  const stigmer = useStigmer();

  const { data: report, isLoading, isRefetching, error, refetch } = useFetch(
    orgId
      ? () =>
          stigmer.agentExecution.getOrgUsageReport(
            create(GetOrgUsageReportInputSchema, {
              orgId,
              fromDate: dateRange.from,
              toDate: dateRange.to,
            }),
          )
      : null,
    [orgId, dateRange.from, dateRange.to, stigmer],
    null as GetOrgUsageReportOutput | null,
  );

  return { report, isLoading, isRefetching, error, refetch };
}
