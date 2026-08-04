"use client";

import type { Schedule } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import { isNotFound } from "@stigmer/sdk";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";

/** Return value of {@link useSchedule}. */
export interface UseScheduleReturn {
  /** The resolved schedule, or `null` while loading, on error, or when not found. */
  readonly schedule: Schedule | null;
  /** `true` while the initial fetch is in flight. */
  readonly isLoading: boolean;
  /** `true` while a background refetch is in flight. */
  readonly isRefetching: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch the schedule from the server. */
  readonly refetch: () => void;
}

/**
 * Data hook that fetches a single Schedule by organization and slug.
 *
 * Wraps `stigmer.schedule.getByReference()` with loading, error, and
 * not-found state management. The loaded resource carries the spec
 * (cron, time zone, enabled, target) and the platform-written status
 * (`next_fire_at`, `last_fire_at`, `last_execution_id`,
 * `consecutive_failures`, `paused_reason`) — everything the detail view
 * renders, including the disabled-vs-paused distinction (see
 * {@link deriveScheduleState}).
 *
 * Pass `null` for either `org` or `slug` to skip fetching (stable
 * no-op).
 *
 * **Not-found handling:** a NOT_FOUND response sets `schedule` to
 * `null` without raising an error; `schedule === null && !isLoading
 * && !error` means the resource does not exist.
 *
 * @example
 * ```tsx
 * const { schedule, isLoading, error, refetch } = useSchedule("isc", "daily-fee-reminders");
 * ```
 */
export function useSchedule(
  org: string | null,
  slug: string | null,
): UseScheduleReturn {
  const stigmer = useStigmer();

  const { data: schedule, isLoading, isRefetching, error, refetch } = useFetch(
    org && slug
      ? async () => {
          try {
            return await stigmer.schedule.getByReference({ org, slug });
          } catch (err) {
            if (isNotFound(err)) return null;
            throw err;
          }
        }
      : null,
    [org, slug, stigmer],
    null,
  );

  return { schedule, isLoading, isRefetching, error, refetch };
}
