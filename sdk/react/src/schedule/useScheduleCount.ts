"use client";

import { useStigmer } from "../hooks.js";
import { LIST_PAGE_MAX } from "../internal/everyPage.js";
import { useFetch } from "../internal/useFetch.js";
import { listSchedulesPage } from "./scheduleListFn.js";

/** Options for {@link useScheduleCount}. */
export interface UseScheduleCountOptions {
  /** Opaque token that forces a recount when its value changes. */
  readonly refetchToken?: unknown;
}

/** Return value of {@link useScheduleCount}. */
export interface UseScheduleCountReturn {
  /**
   * The schedules a first page holds, up to 100. `undefined` until the
   * first successful fetch completes.
   */
  readonly count: number | undefined;
  /**
   * `true` when more schedules follow that page: a card reads "100+"
   * rather than a total the list does not carry.
   */
  readonly isLowerBound: boolean;
  /** `true` while the count fetch is in flight. */
  readonly isLoading: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch the count from the server. */
  readonly refetch: () => void;
}

interface ScheduleCount {
  readonly count: number;
  readonly isLowerBound: boolean;
}

/**
 * Data hook that counts an organization's schedules, for the Library
 * landing card and dashboard widgets.
 *
 * Schedules are not in search, so no per-kind count exists for them: the
 * hook reads the list's largest page and counts it, with `isLowerBound`
 * set when more follow. There is no scope option: schedules are org-only.
 *
 * For the schedules themselves, use {@link useScheduleList} instead.
 *
 * Pass `null` as `org` to skip fetching (stable no-op).
 *
 * @example
 * ```tsx
 * const { count, isLowerBound, isLoading } = useScheduleCount("isc");
 * ```
 */
export function useScheduleCount(
  org: string | null,
  options?: UseScheduleCountOptions,
): UseScheduleCountReturn {
  const stigmer = useStigmer();
  const refetchToken = options?.refetchToken;

  const { data, isLoading, error, refetch } = useFetch<ScheduleCount | undefined>(
    org
      ? async () => {
          const page = await listSchedulesPage(stigmer, org, { pageSize: LIST_PAGE_MAX });
          return { count: page.entries.length, isLowerBound: page.nextPageToken !== "" };
        }
      : null,
    [stigmer, org, refetchToken],
    undefined,
  );

  return {
    count: data?.count,
    isLowerBound: data?.isLowerBound ?? false,
    isLoading,
    error,
    refetch,
  };
}
