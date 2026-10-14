"use client";

import { create } from "@bufbuild/protobuf";
import {
  ListScheduleFiresRequestSchema,
  type ScheduleFire,
} from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { useTokenPages } from "../internal/useTokenPages.js";

/** Options for {@link useScheduleFires}. */
export interface UseScheduleFiresOptions {
  /** Maximum fires per page. @default 25 */
  readonly pageSize?: number;
}

/** Return value of {@link useScheduleFires}. */
export interface UseScheduleFiresReturn {
  /** Recorded fires for the shown page, newest first. */
  readonly fires: readonly ScheduleFire[];
  /** The shown page's number, 1 on the newest fires. */
  readonly pageNumber: number;
  /** `true` when older fires follow the shown page. */
  readonly hasNext: boolean;
  /** `true` when a newer page was shown before this one. */
  readonly hasPrevious: boolean;
  /** Show the next (older) page. */
  readonly next: () => void;
  /** Show the page before (newer). */
  readonly previous: () => void;
  /** `true` while the initial fetch is in flight. */
  readonly isLoading: boolean;
  /** `true` while a background refetch is in flight. */
  readonly isRefetching: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch the shown page from the server. */
  readonly refetch: () => void;
}

/**
 * Data hook that fetches a schedule's fire history, newest first — the
 * fire ledger.
 *
 * Every fire leaves a row, INCLUDING the fires that created no run
 * (a refused launch gate, a missing target agent), carrying the refusing
 * gate's copy verbatim. This is the surface that finally explains
 * `status.consecutive_failures`: the reason is one row away instead of
 * buried in server logs. Rows for in-flight fires are enriched server-side
 * with the run's live phase, so outcomes never lie. The history pages
 * newest first with `next` / `previous`; it carries no total.
 *
 * Pass `null` as `scheduleId` to skip fetching (stable no-op) — the
 * detail view does this while the schedule itself is still loading.
 *
 * @example
 * ```tsx
 * const { fires, hasNext, next, isLoading } = useScheduleFires(schedule?.metadata?.id ?? null);
 * ```
 */
export function useScheduleFires(
  scheduleId: string | null,
  options?: UseScheduleFiresOptions,
): UseScheduleFiresReturn {
  const stigmer = useStigmer();
  const pageSize = options?.pageSize ?? 25;

  const pages = useTokenPages<ScheduleFire>(
    scheduleId
      ? (pageToken) =>
          stigmer.schedule.listFires(
            create(ListScheduleFiresRequestSchema, { scheduleId, pageSize, pageToken }),
          )
      : null,
    [stigmer, scheduleId, pageSize],
  );

  return {
    fires: pages.entries,
    pageNumber: pages.pageNumber,
    hasNext: pages.hasNext,
    hasPrevious: pages.hasPrevious,
    next: pages.next,
    previous: pages.previous,
    isLoading: pages.isLoading,
    isRefetching: pages.isRefetching,
    error: pages.error,
    refetch: pages.refetch,
  };
}
