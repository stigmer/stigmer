"use client";

import { create } from "@bufbuild/protobuf";
import type { RunSummary } from "@stigmer/protos/ai/stigmer/agentic/run/v1/io_pb";
import {
  RunSummaryTimeWindow,
  GetRunSummaryRequestSchema,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";

export { RunSummaryTimeWindow };

/** Options for {@link useRunSummary}. */
export interface UseRunSummaryOptions {
  /** Organization id (a slug is also accepted). When empty/null, the hook does not fetch. */
  readonly org: string | null | undefined;
  /** Time window for aggregation. @default LAST_7D */
  readonly timeWindow?: RunSummaryTimeWindow;
  /** Refetch interval in milliseconds. `0` or `false` disables. @default 0 */
  readonly refetchInterval?: number | false;
}

/** Return value of {@link useRunSummary}. */
export interface UseRunSummaryReturn {
  readonly summary: RunSummary | null;
  readonly isLoading: boolean;
  readonly isRefetching: boolean;
  readonly error: Error | null;
  readonly refetch: () => void;
}

/**
 * Data hook that fetches aggregated agent run statistics for an
 * organization. Returns phase counts, active count, average duration,
 * and top failing agents.
 *
 * Cost is intentionally excluded from this response — the dashboard
 * sources cost from `useOrgUsageReport` (billing source of truth), so
 * cost is never counted from two sources.
 */
export function useRunSummary(
  options: UseRunSummaryOptions,
): UseRunSummaryReturn {
  const stigmer = useStigmer();
  const org = options.org ?? "";
  const timeWindow =
    options.timeWindow ??
    RunSummaryTimeWindow.LAST_7D;
  const refetchInterval = options.refetchInterval ?? 0;

  const fetchFn = org
    ? async () => {
        return await stigmer.run.getRunSummary(
          create(GetRunSummaryRequestSchema, { org, timeWindow }),
        );
      }
    : null;

  const { data, isLoading, isRefetching, error, refetch } =
    useFetch<RunSummary | null>(
      fetchFn,
      [stigmer, org, timeWindow],
      null,
      { refetchInterval: refetchInterval || false },
    );

  return { summary: data, isLoading, isRefetching, error, refetch };
}
