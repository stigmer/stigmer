"use client";

import { useCallback, useEffect, useState } from "react";
import { create } from "@bufbuild/protobuf";
import type { Runner } from "@stigmer/protos/ai/stigmer/agentic/runner/v1/api_pb";
import { ListRunnersRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/runner/v1/io_pb";
import { useStigmer } from "../hooks";
import { toError } from "../internal/toError";

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
}

/** Return value of {@link useRunnerList}. */
export interface UseRunnerListReturn {
  /** User-created runners for the organization, empty while loading or on error. */
  readonly runners: readonly Runner[];
  /** `true` while the fetch is in flight. */
  readonly isLoading: boolean;
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
  const [runners, setRunners] = useState<Runner[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [fetchKey, setFetchKey] = useState(0);

  const includeSystemManaged = options?.includeSystemManaged ?? false;

  const refetch = useCallback(() => setFetchKey((k) => k + 1), []);

  useEffect(() => {
    if (!org) {
      setRunners([]);
      setIsLoading(false);
      setError(null);
      return;
    }

    const cancelled = { current: false };
    setIsLoading(true);
    setError(null);

    stigmer.runner
      .list(create(ListRunnersRequestSchema, { org }))
      .then(
        (result) => {
          if (cancelled.current) return;

          const items = includeSystemManaged
            ? result.items
            : result.items.filter(
                (r) => r.metadata?.labels[SYSTEM_MANAGED_LABEL] !== "true",
              );

          setRunners(items);
          setIsLoading(false);
        },
        (err) => {
          if (cancelled.current) return;
          setError(toError(err));
          setIsLoading(false);
        },
      );

    return () => {
      cancelled.current = true;
    };
  }, [stigmer, org, includeSystemManaged, fetchKey]);

  return { runners, isLoading, error, refetch };
}
