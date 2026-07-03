"use client";

import type {
  BillingUsageReportResponse,
} from "@stigmer/protos/ai/stigmer/billing/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";

/** Return value of {@link useBillingUsageReport}. */
export interface UseBillingUsageReportReturn {
  /** The usage report, or `null` before the first successful fetch. */
  readonly report: BillingUsageReportResponse | null;
  /** `true` while the initial fetch is in flight. */
  readonly isLoading: boolean;
  /** `true` while a background refetch is in flight and stale data is shown. */
  readonly isRefetching: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch from the server. */
  readonly refetch: () => void;
}

/**
 * Data hook that fetches an aggregated billing usage report for a date range.
 *
 * Returns total provider cost, total billable amount, execution and LLM
 * call counts, and a per-model breakdown with cost tier attribution.
 *
 * Pass `null` as `orgId` to skip fetching (stable no-op).
 *
 * @param orgId - Organization ID, or `null` to skip.
 * @param startTime - Start of the reporting period.
 * @param endTime - End of the reporting period.
 *
 * @example
 * ```tsx
 * const { report, isLoading } = useBillingUsageReport(
 *   orgId,
 *   new Date("2026-05-01"),
 *   new Date("2026-05-31"),
 * );
 *
 * if (isLoading) return <Skeleton />;
 * if (!report) return null;
 *
 * return <div>Total: {formatCreditBalance(report.totalBillableAmountMicros)}</div>;
 * ```
 */
export function useBillingUsageReport(
  orgId: string | null,
  startTime: Date,
  endTime: Date,
): UseBillingUsageReportReturn {
  const stigmer = useStigmer();

  const startKey = startTime.toISOString();
  const endKey = endTime.toISOString();

  const { data: report, isLoading, isRefetching, error, refetch } = useFetch(
    orgId
      ? () =>
          stigmer.billing.getBillingUsageReport({
            orgId,
            startTime,
            endTime,
          })
      : null,
    [orgId, startKey, endKey, stigmer],
    null as BillingUsageReportResponse | null,
  );

  return { report, isLoading, isRefetching, error, refetch };
}
