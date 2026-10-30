"use client";

import { useStigmer } from "@stigmer/react-core";
import { LIST_PAGE_MAX } from "@stigmer/react-core/internal";
import { useFetch } from "@stigmer/react-core/internal";
import { listRoutinesPage } from "./routineListFn.js";

/** Options for {@link useRoutineCount}. */
export interface UseRoutineCountOptions {
  /** Opaque token that forces a recount when its value changes. */
  readonly refetchToken?: unknown;
}

/** Return value of {@link useRoutineCount}. */
export interface UseRoutineCountReturn {
  /**
   * The routines a first page holds, up to 100. `undefined` until the
   * first successful fetch completes.
   */
  readonly count: number | undefined;
  /**
   * `true` when more routines follow that page: a card reads "100+"
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

interface RoutineCount {
  readonly count: number;
  readonly isLowerBound: boolean;
}

/**
 * Data hook that counts an organization's routines, for the Library
 * landing card and dashboard widgets.
 *
 * Routines are not in search, so no per-kind count exists for them: the
 * hook reads the list's largest page and counts it, with `isLowerBound`
 * set when more follow. There is no scope option: routines are org-only.
 *
 * For the routines themselves, use {@link useRoutineList} instead.
 *
 * Pass `null` as `org` to skip fetching (stable no-op).
 *
 * @example
 * ```tsx
 * const { count, isLowerBound, isLoading } = useRoutineCount("isc");
 * ```
 */
export function useRoutineCount(
  org: string | null,
  options?: UseRoutineCountOptions,
): UseRoutineCountReturn {
  const stigmer = useStigmer();
  const refetchToken = options?.refetchToken;

  const { data, isLoading, error, refetch } = useFetch<RoutineCount | undefined>(
    org
      ? async () => {
          const page = await listRoutinesPage(stigmer, org, { pageSize: LIST_PAGE_MAX });
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
