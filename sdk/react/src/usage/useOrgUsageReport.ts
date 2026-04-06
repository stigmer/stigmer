"use client";

import { useCallback, useEffect, useState } from "react";
import { create } from "@bufbuild/protobuf";
import {
  GetOrgUsageReportInputSchema,
  type GetOrgUsageReportOutput,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import type { ModelUsage } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/usage_pb";
import { useStigmer } from "../hooks";
import { toError } from "../internal/toError";
import type { DateRange } from "./date-range";

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
 * return <div>Total cost: {formatCost(report.totalCostUsd)}</div>;
 * ```
 */
export function useOrgUsageReport(
  orgId: string | null,
  dateRange: DateRange,
): UseOrgUsageReportReturn {
  const stigmer = useStigmer();
  const [report, setReport] = useState<GetOrgUsageReportOutput | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [fetchKey, setFetchKey] = useState(0);

  const refetch = useCallback(() => setFetchKey((k) => k + 1), []);

  useEffect(() => {
    if (!orgId) {
      setReport(null);
      setIsLoading(false);
      setError(null);
      return;
    }

    const cancelled = { current: false };
    setIsLoading(true);
    setError(null);

    stigmer.agentExecution
      .getOrgUsageReport(
        create(GetOrgUsageReportInputSchema, {
          orgId,
          fromDate: dateRange.from,
          toDate: dateRange.to,
        }),
      )
      .then(
        (result) => {
          if (cancelled.current) return;
          setReport(result);
          setIsLoading(false);
        },
        (err) => {
          if (cancelled.current) return;
          setError(toError(err));
          setIsLoading(false);
        },
      );

    return () => {
      cancelled.current = true;
    };
  }, [orgId, dateRange.from, dateRange.to, stigmer, fetchKey]);

  return { report, isLoading, error, refetch };
}
