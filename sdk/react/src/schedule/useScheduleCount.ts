"use client";

import { useMemo } from "react";
import { useStigmer } from "../hooks.js";
import { useResourceCount } from "../search/index.js";
import { createScheduleListFn } from "./scheduleListFn.js";

/** Options for {@link useScheduleCount}. */
export interface UseScheduleCountOptions {
  /** Opaque token that forces a recount when its value changes. */
  readonly refetchToken?: unknown;
}

/** Return value of {@link useScheduleCount}. */
export interface UseScheduleCountReturn {
  /**
   * Total number of schedules in the organization. `undefined` until
   * the first successful fetch completes.
   */
  readonly count: number | undefined;
  /** `true` while the count fetch is in flight. */
  readonly isLoading: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch the count from the server. */
  readonly refetch: () => void;
}

/**
 * Data hook that fetches the total count of an organization's schedules.
 *
 * Issues a minimal direct `listSchedules` call to retrieve only the
 * total count. Useful for the Library landing card and dashboard
 * widgets. There is no scope option: schedules are org-only.
 *
 * For the full paginated schedule list, use {@link useScheduleList}
 * instead.
 *
 * Pass `null` as `org` to skip fetching (stable no-op).
 *
 * @example
 * ```tsx
 * const { count, isLoading } = useScheduleCount("isc");
 * ```
 */
export function useScheduleCount(
  org: string | null,
  options?: UseScheduleCountOptions,
): UseScheduleCountReturn {
  const stigmer = useStigmer();

  const listFn = useMemo(() => createScheduleListFn(stigmer), [stigmer]);

  return useResourceCount(listFn, org, {
    refetchToken: options?.refetchToken,
  });
}
