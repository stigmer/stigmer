"use client";

import { create } from "@bufbuild/protobuf";
import {
  ListScheduleRunsRequestSchema,
  type ScheduleRun,
} from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";

/** Options for {@link useScheduleRuns}. */
export interface UseScheduleRunsOptions {
  /** Maximum runs per page. @default 25 */
  readonly pageSize?: number;
  /** Page number (1-indexed). @default 1 */
  readonly page?: number;
}

/** Return value of {@link useScheduleRuns}. */
export interface UseScheduleRunsReturn {
  /** Recorded fires for the current page, newest first. */
  readonly runs: readonly ScheduleRun[];
  /** Total number of recorded runs for the schedule. */
  readonly totalCount: number;
  /** `true` while the initial fetch is in flight. */
  readonly isLoading: boolean;
  /** `true` while a background refetch is in flight. */
  readonly isRefetching: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch the current page from the server. */
  readonly refetch: () => void;
}

interface RunsPage {
  readonly runs: readonly ScheduleRun[];
  readonly totalCount: number;
}

const INITIAL_PAGE: RunsPage = { runs: [], totalCount: 0 };

/**
 * Data hook that fetches a schedule's run history, newest first — the
 * fire ledger (project DD-017 D-7).
 *
 * Every fire leaves a row, INCLUDING the fires that created no execution
 * (a refused launch gate, a missing target agent), carrying the refusing
 * gate's copy verbatim. This is the surface that finally explains
 * `status.consecutive_failures`: the reason is one row away instead of
 * buried in server logs. Rows for in-flight runs are enriched server-side
 * with the execution's live phase, so outcomes never lie.
 *
 * Pass `null` as `scheduleId` to skip fetching (stable no-op) — the
 * detail view does this while the schedule itself is still loading.
 *
 * @example
 * ```tsx
 * const { runs, totalCount, isLoading } = useScheduleRuns(schedule?.metadata?.id ?? null);
 * ```
 */
export function useScheduleRuns(
  scheduleId: string | null,
  options?: UseScheduleRunsOptions,
): UseScheduleRunsReturn {
  const stigmer = useStigmer();
  const pageSize = options?.pageSize ?? 25;
  const page = options?.page ?? 1;

  const { data, isLoading, isRefetching, error, refetch } = useFetch<RunsPage>(
    scheduleId
      ? async () => {
          const result = await stigmer.schedule.listRuns(
            create(ListScheduleRunsRequestSchema, {
              scheduleId,
              pageInfo: { num: page, size: pageSize },
            }),
          );
          return { runs: result.items, totalCount: result.totalCount };
        }
      : null,
    [stigmer, scheduleId, page, pageSize],
    INITIAL_PAGE,
  );

  return {
    runs: data.runs,
    totalCount: data.totalCount,
    isLoading,
    isRefetching,
    error,
    refetch,
  };
}
