"use client";

import type { Routine } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import { isNotFound } from "@stigmer/client";
import { useStigmer } from "@stigmer/react-core";
import { useFetch } from "@stigmer/react-core/internal";

/** Return value of {@link useRoutine}. */
export interface UseRoutineReturn {
  /** The resolved routine, or `null` while loading, on error, or when not found. */
  readonly routine: Routine | null;
  /** `true` while the initial fetch is in flight. */
  readonly isLoading: boolean;
  /** `true` while a background refetch is in flight. */
  readonly isRefetching: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch the routine from the server. */
  readonly refetch: () => void;
}

/**
 * Data hook that fetches a single Routine by organization and slug.
 *
 * Wraps `stigmer.routine.getByReference()` with loading, error, and
 * not-found state management. The loaded resource carries the spec
 * (cron, time zone, enabled, target) and the platform-written status
 * (`next_fire_at`, `last_fire_at`, `last_run_id`,
 * `consecutive_failures`, `paused_reason`) — everything the detail view
 * renders, including the disabled-vs-paused distinction (see
 * {@link deriveRoutineState}).
 *
 * Pass `null` for either `org` or `slug` to skip fetching (stable
 * no-op).
 *
 * **Not-found handling:** a NOT_FOUND response sets `routine` to
 * `null` without raising an error; `routine === null && !isLoading
 * && !error` means the resource does not exist.
 *
 * @example
 * ```tsx
 * const { routine, isLoading, error, refetch } = useRoutine("isc", "daily-fee-reminders");
 * ```
 */
export function useRoutine(
  org: string | null,
  slug: string | null,
): UseRoutineReturn {
  const stigmer = useStigmer();

  const { data: routine, isLoading, isRefetching, error, refetch } = useFetch(
    org && slug
      ? async () => {
          try {
            return await stigmer.routine.getByReference({ org, slug });
          } catch (err) {
            if (isNotFound(err)) return null;
            throw err;
          }
        }
      : null,
    [org, slug, stigmer],
    null,
  );

  return { routine, isLoading, isRefetching, error, refetch };
}
