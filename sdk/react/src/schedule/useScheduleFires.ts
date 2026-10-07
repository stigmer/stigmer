"use client";

import { create } from "@bufbuild/protobuf";
import {
  ListScheduleFiresRequestSchema,
  type ScheduleFire,
} from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";

/** Options for {@link useScheduleFires}. */
export interface UseScheduleFiresOptions {
  /** Maximum fires per page. @default 25 */
  readonly pageSize?: number;
  /** Page number (1-indexed). @default 1 */
  readonly page?: number;
}

/** Return value of {@link useScheduleFires}. */
export interface UseScheduleFiresReturn {
  /** Recorded fires for the current page, newest first. */
  readonly fires: readonly ScheduleFire[];
  /** Total number of recorded fires for the schedule. */
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

interface FiresPage {
  readonly fires: readonly ScheduleFire[];
  readonly totalCount: number;
}

const INITIAL_PAGE: FiresPage = { fires: [], totalCount: 0 };

/**
 * Data hook that fetches a schedule's fire history, newest first — the
 * fire ledger.
 *
 * Every fire leaves a row, INCLUDING the fires that created no run
 * (a refused launch gate, a missing target agent), carrying the refusing
 * gate's copy verbatim. This is the surface that finally explains
 * `status.consecutive_failures`: the reason is one row away instead of
 * buried in server logs. Rows for in-flight fires are enriched server-side
 * with the run's live phase, so outcomes never lie.
 *
 * Pass `null` as `scheduleId` to skip fetching (stable no-op) — the
 * detail view does this while the schedule itself is still loading.
 *
 * @example
 * ```tsx
 * const { fires, totalCount, isLoading } = useScheduleFires(schedule?.metadata?.id ?? null);
 * ```
 */
export function useScheduleFires(
  scheduleId: string | null,
  options?: UseScheduleFiresOptions,
): UseScheduleFiresReturn {
  const stigmer = useStigmer();
  const pageSize = options?.pageSize ?? 25;
  const page = options?.page ?? 1;

  const { data, isLoading, isRefetching, error, refetch } = useFetch<FiresPage>(
    scheduleId
      ? async () => {
          const result = await stigmer.schedule.listFires(
            create(ListScheduleFiresRequestSchema, {
              scheduleId,
              pageInfo: { num: page, size: pageSize },
            }),
          );
          return { fires: result.items, totalCount: result.totalCount };
        }
      : null,
    [stigmer, scheduleId, page, pageSize],
    INITIAL_PAGE,
  );

  return {
    fires: data.fires,
    totalCount: data.totalCount,
    isLoading,
    isRefetching,
    error,
    refetch,
  };
}
