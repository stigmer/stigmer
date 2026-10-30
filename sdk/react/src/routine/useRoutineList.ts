"use client";

import type { Routine } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import { useStigmer } from "@stigmer/react-core";
import { useCursorPages } from "@stigmer/react-core/internal";
import { listRoutinesPage } from "./routineListFn.js";

/** Options for {@link useRoutineList}. */
export interface UseRoutineListOptions {
  /** Maximum routines per page, the first and each `loadMore`. @default 20 */
  readonly pageSize?: number;
}

/** Return value of {@link useRoutineList}. */
export interface UseRoutineListReturn {
  /** Full `Routine` protos (spec + status), the first page then each page loaded since. */
  readonly routines: readonly Routine[];
  /** `true` while the server holds routines beyond those loaded. */
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
 * Data hook that lists an organization's routines, newest first, a page at
 * a time (`hasMore` / `loadMore`; a list carries no total).
 *
 * Backed by the direct `listRoutines` query — not the search service —
 * so each entry is a full `Routine` proto with the operational status
 * fields a routine list exists to show (`next_fire_at`, enabled/paused
 * state, `last_fire_at`). There is no text query or visibility scope:
 * routines are org-only and have no server-side search.
 *
 * Pass `null` as `org` to skip fetching (stable no-op).
 *
 * @example
 * ```tsx
 * const { routines, hasMore, loadMore, isLoading } = useRoutineList("isc", {
 *   pageSize: 20,
 * });
 * ```
 */
export function useRoutineList(
  org: string | null,
  options?: UseRoutineListOptions,
): UseRoutineListReturn {
  const stigmer = useStigmer();
  const pageSize = options?.pageSize;

  const pages = useCursorPages<Routine>(
    org ? (pageToken) => listRoutinesPage(stigmer, org, { pageSize, pageToken }) : null,
    [stigmer, org, pageSize],
    (routine) => routine.metadata?.id ?? "",
  );

  return {
    routines: pages.items,
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
