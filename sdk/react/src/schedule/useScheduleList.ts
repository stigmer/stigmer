"use client";

import type { Schedule } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import { useStigmer } from "../hooks.js";
import { useCursorPages } from "../internal/useCursorPages.js";
import { listSchedulesPage } from "./scheduleListFn.js";

/** Options for {@link useScheduleList}. */
export interface UseScheduleListOptions {
  /** Maximum schedules per page, the first and each `loadMore`. @default 20 */
  readonly pageSize?: number;
}

/** Return value of {@link useScheduleList}. */
export interface UseScheduleListReturn {
  /** Full `Schedule` protos (spec + status), the first page then each page loaded since. */
  readonly schedules: readonly Schedule[];
  /** `true` while the server holds schedules beyond those loaded. */
  readonly hasMore: boolean;
  /** Load the next page. No-op while one is loading or when nothing follows. */
  readonly loadMore: () => void;
  /** `true` while a `loadMore` read is in flight. */
  readonly isLoadingMore: boolean;
  /** Error from the last failed `loadMore`, or `null`. */
  readonly loadMoreError: Error | null;
  /** `true` while the initial fetch is in flight. */
  readonly isLoading: boolean;
  /** `true` while a background refetch is in flight. */
  readonly isRefetching: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Re-read the first page; pages loaded since stay. */
  readonly refetch: () => void;
}

/**
 * Data hook that lists an organization's schedules, newest first, a page at
 * a time (`hasMore` / `loadMore`; a list carries no total).
 *
 * Backed by the direct `listSchedules` query — not the search service —
 * so each entry is a full `Schedule` proto with the operational status
 * fields a schedule list exists to show (`next_fire_at`, enabled/paused
 * state, `last_fire_at`). There is no text query or visibility scope:
 * schedules are org-only and have no server-side search.
 *
 * Pass `null` as `org` to skip fetching (stable no-op).
 *
 * @example
 * ```tsx
 * const { schedules, hasMore, loadMore, isLoading } = useScheduleList("isc", {
 *   pageSize: 20,
 * });
 * ```
 */
export function useScheduleList(
  org: string | null,
  options?: UseScheduleListOptions,
): UseScheduleListReturn {
  const stigmer = useStigmer();
  const pageSize = options?.pageSize;

  const pages = useCursorPages<Schedule>(
    org ? (pageToken) => listSchedulesPage(stigmer, org, { pageSize, pageToken }) : null,
    [stigmer, org, pageSize],
    (schedule) => schedule.metadata?.id ?? "",
  );

  return {
    schedules: pages.items,
    hasMore: pages.hasMore,
    loadMore: pages.loadMore,
    isLoadingMore: pages.isLoadingMore,
    loadMoreError: pages.loadMoreError,
    isLoading: pages.isLoading,
    isRefetching: pages.isRefetching,
    error: pages.error,
    refetch: pages.refetch,
  };
}
