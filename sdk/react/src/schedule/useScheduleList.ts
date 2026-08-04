"use client";

import type { Schedule } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";
import { listSchedulesPage, type SchedulePage } from "./scheduleListFn.js";

/** Options for {@link useScheduleList}. */
export interface UseScheduleListOptions {
  /** Maximum schedules per page. @default 20 */
  readonly pageSize?: number;
  /** Page number (1-indexed). @default 1 */
  readonly page?: number;
}

/** Return value of {@link useScheduleList}. */
export interface UseScheduleListReturn {
  /** Full `Schedule` protos (spec + status) for the current page. */
  readonly schedules: readonly Schedule[];
  /** Total number of schedules in the organization. */
  readonly totalCount: number;
  /** Total pages available at the current page size. */
  readonly totalPages: number;
  /** The current page number (mirrors the `page` option). */
  readonly currentPage: number;
  /** `true` while the initial fetch is in flight. */
  readonly isLoading: boolean;
  /** `true` while a background refetch is in flight. */
  readonly isRefetching: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch the current page from the server. */
  readonly refetch: () => void;
}

const INITIAL_PAGE: SchedulePage = { items: [], totalCount: 0, totalPages: 0 };

/**
 * Data hook that fetches a paginated list of an organization's schedules.
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
 * const { schedules, totalCount, isLoading } = useScheduleList("isc", {
 *   page: 1,
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
  const page = options?.page ?? 1;

  const { data, isLoading, isRefetching, error, refetch } = useFetch<SchedulePage>(
    org
      ? () => listSchedulesPage(stigmer, org, { num: page, size: pageSize })
      : null,
    [stigmer, org, page, pageSize],
    INITIAL_PAGE,
  );

  return {
    schedules: data.items,
    totalCount: data.totalCount,
    totalPages: data.totalPages,
    currentPage: page,
    isLoading,
    isRefetching,
    error,
    refetch,
  };
}
