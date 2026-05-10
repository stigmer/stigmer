"use client";

import type { Runner } from "@stigmer/protos/ai/stigmer/agentic/runner/v1/api_pb";
import { useStigmer } from "../hooks";
import { useFetch, type UseFetchOptions } from "../internal/useFetch";

/** Return value of {@link useRunner}. */
export interface UseRunnerReturn {
  /** The fetched runner, or `null` while loading or on error. */
  readonly runner: Runner | null;
  /** `true` while the initial fetch is in flight. */
  readonly isLoading: boolean;
  /** Error from the last failed fetch, or `null` when healthy. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch the runner from the server. */
  readonly refetch: () => void;
}

/** Options for {@link useRunner}. */
export interface UseRunnerOptions {
  /**
   * Poll interval in milliseconds for automatic re-fetching.
   *
   * Useful for monitoring runner status transitions (e.g. Starting
   * to Ready) without requiring manual refresh.
   */
  readonly refetchInterval?: UseFetchOptions["refetchInterval"];
}

/**
 * Data hook that fetches a single runner by ID.
 *
 * Calls `stigmer.runner.get(id)` and returns the result with
 * loading/error state. Returns `null` runner when `id` is `null`
 * (no runner selected).
 *
 * @example
 * ```tsx
 * const { runner, isLoading, error } = useRunner(runnerId);
 * ```
 */
export function useRunner(
  id: string | null,
  options?: UseRunnerOptions,
): UseRunnerReturn {
  const stigmer = useStigmer();
  const refetchInterval = options?.refetchInterval;

  const { data: runner, isLoading, error, refetch } = useFetch(
    id
      ? async () => stigmer.runner.get(id)
      : null,
    [stigmer, id],
    null as Runner | null,
    { refetchInterval },
  );

  return { runner, isLoading, error, refetch };
}
