"use client";

/**
 * Data hook over `getOrgUsageReport`: the organization's tokens, runs,
 * calls, per-model, per-agent, per-day and per-harness rows for a date
 * range, and who served the tokens. Usage is tokens, never money.
 *
 * A thin `useFetch` wrapper keyed by organization and range; the panel and
 * the dashboard both read through it, so they share one cached report. The
 * panel and dashboard suites stub it; its own behaviour is the shared
 * `useFetch` contract.
 */

import { create } from "@bufbuild/protobuf";
import {
  GetOrgUsageReportInputSchema,
  type GetOrgUsageReportOutput,
} from "@stigmer/apis/ai/stigmer/agentic/run/v1/io_pb";
import type { ModelUsage } from "@stigmer/apis/ai/stigmer/agentic/run/v1/usage_pb";
import { useStigmer } from "@stigmer/react-core";
import { useFetch } from "@stigmer/react-core/internal";
import type { DateRange } from "./date-range.js";

/**
 * Per-model usage row of an org report (tokens and calls per model).
 *
 * Re-exported so consumers don't need to depend on `@stigmer/apis`
 * directly for type-safe rendering.
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
 * Calls `stigmer.run.getOrgUsageReport` with the provided
 * org ID and date range. The server returns the organization's total
 * usage (tokens, calls, who served them), a per-model breakdown, the
 * agents with the most tokens, a daily token trend and the harness split,
 * counting only the runs the caller can read.
 *
 * Pass `null` as `org` to skip fetching (stable no-op). Call
 * `refetch()` to re-query manually.
 *
 * @param org - Organization ID, or `null` to skip.
 * @param dateRange - Closed date range of UTC calendar days (YYYY-MM-DD);
 *   the server counts runs created from the start of `from` through the
 *   end of `to`.
 *
 * @example
 * ```tsx
 * const range = dateRangeFromPreset("30d");
 * const { report, isLoading, error } = useOrgUsageReport(org, range);
 *
 * if (isLoading) return <Skeleton />;
 * if (error) return <ErrorMessage error={error} />;
 * if (!report) return null;
 *
 * const tokens = report.totalUsage?.totalTokens ?? 0n;
 * return <div>{tokens.toLocaleString()} tokens</div>;
 * ```
 */
export function useOrgUsageReport(
  org: string | null,
  dateRange: DateRange,
): UseOrgUsageReportReturn {
  const stigmer = useStigmer();

  const { data: report, isLoading, isRefetching, error, refetch } = useFetch(
    org
      ? () =>
          stigmer.run.getOrgUsageReport(
            create(GetOrgUsageReportInputSchema, {
              org,
              fromDate: dateRange.from,
              toDate: dateRange.to,
            }),
          )
      : null,
    [org, dateRange.from, dateRange.to, stigmer],
    null as GetOrgUsageReportOutput | null,
  );

  return { report, isLoading, isRefetching, error, refetch };
}
