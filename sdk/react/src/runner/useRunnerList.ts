"use client";

import { create } from "@bufbuild/protobuf";
import type { Runner } from "@stigmer/protos/ai/stigmer/agentic/runner/v1/api_pb";
import { ListRunnersRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/runner/v1/io_pb";
import { useStigmer } from "../hooks";
import { useFetch, type UseFetchOptions } from "../internal/useFetch";

const SYSTEM_MANAGED_LABEL = "stigmer.ai/system-managed";

/** Options for {@link useRunnerList}. */
export interface UseRunnerListOptions {
  /**
   * Include system-managed (ephemeral cloud) runners in the result.
   *
   * System-managed runners are labeled `stigmer.ai/system-managed: "true"`
   * and are created by the platform for cloud executions. They are hidden
   * from the session composer by default but useful in admin views.
   *
   * @default false
   */
  readonly includeSystemManaged?: boolean;
  /**
   * Poll interval in milliseconds for automatic re-fetching.
   *
   * When set to a positive number, the hook re-fetches the runner list
   * on a timer. Useful for monitoring status transitions (e.g. Pending
   * to Ready) without requiring the user to navigate away and back.
   *
   * Set to `false` or `0` to disable polling (the default).
   *
   * @example
   * ```tsx
   * // Poll every 5 seconds while runners are transitioning
   * const { runners } = useRunnerList("acme", {
   *   refetchInterval: hasPendingRunners ? 5000 : false,
   * });
   * ```
   */
  readonly refetchInterval?: UseFetchOptions["refetchInterval"];
}

/** Return value of {@link useRunnerList}. */
export interface UseRunnerListReturn {
  /** User-created runners for the organization, empty while loading or on error. */
  readonly runners: readonly Runner[];
  /** `true` while the fetch is in flight. */
  readonly isLoading: boolean;
  /** `true` while a background refetch is in flight and stale data is shown. */
  readonly isRefetching: boolean;
  /** Error from the last failed fetch, or `null` when healthy. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch the runner list from the server. */
  readonly refetch: () => void;
}

/**
 * Data hook that fetches runners for an organization.
 *
 * Calls `stigmer.runner.list({ org })` and returns the result with
 * loading/error state. System-managed (ephemeral cloud) runners are
 * filtered out by default — pass `includeSystemManaged: true` to
 * include them (useful for admin panels like Settings > Runners).
 *
 * Returns an empty array when `org` is `null` (no organization selected).
 *
 * @example
 * ```tsx
 * // Session composer — user-created runners only
 * const { runners, isLoading } = useRunnerList("acme");
 * ```
 *
 * @example
 * ```tsx
 * // Admin page — all runners including system-managed
 * const { runners } = useRunnerList("acme", { includeSystemManaged: true });
 * ```
 */
export function useRunnerList(
  org: string | null,
  options?: UseRunnerListOptions,
): UseRunnerListReturn {
  const stigmer = useStigmer();
  const includeSystemManaged = options?.includeSystemManaged ?? false;
  const refetchInterval = options?.refetchInterval;

  const { data: runners, isLoading, isRefetching, error, refetch } = useFetch(
    org
      ? async () => {
          const result = await stigmer.runner.list(
            create(ListRunnersRequestSchema, { org }),
          );
          return includeSystemManaged
            ? result.items
            : result.items.filter(
                (r) => r.metadata?.labels[SYSTEM_MANAGED_LABEL] !== "true",
              );
        }
      : null,
    [stigmer, org, includeSystemManaged],
    [] as Runner[],
    { refetchInterval },
  );

  return { runners, isLoading, isRefetching, error, refetch };
}
