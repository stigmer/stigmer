"use client";

import { useCallback } from "react";
import { useStigmer } from "../hooks.js";
import { useResourceCount } from "../search/index.js";

/** Options for {@link useAgentCount}. */
export interface UseAgentCountOptions {
  /** Text query to filter agents before counting. */
  readonly query?: string;
  /** Opaque token that forces a recount when its value changes. */
  readonly refetchToken?: unknown;
}

/** Return value of {@link useAgentCount}. */
export interface UseAgentCountReturn {
  /**
   * Total number of agents matching the current filters. `undefined`
   * until the first successful fetch completes.
   */
  readonly count: number | undefined;
  /** `true` while the count fetch is in flight. */
  readonly isLoading: boolean;
  /** Error message from the last failed fetch, or `null` when healthy. */
  readonly error: Error | null;
  /** Re-fetch the count with the same parameters. */
  readonly refetch: () => void;
}

/**
 * Data hook that fetches the total count of agents.
 *
 * Issues a minimal `stigmer.agent.list()` call to retrieve only the
 * total count — no agent entries are returned or stored. Useful for
 * summary cards, badges, and dashboard widgets.
 *
 * For the full paginated agent list, use {@link useAgentList} instead.
 *
 * Pass `null` as `org` to skip fetching (stable no-op).
 *
 * @example
 * ```tsx
 * const { count, isLoading } = useAgentCount("acme");
 * ```
 */
export function useAgentCount(
  org: string | null,
  options?: UseAgentCountOptions,
): UseAgentCountReturn {
  const stigmer = useStigmer();

  const listFn = useCallback(
    (params: Parameters<typeof stigmer.agent.list>[0]) =>
      stigmer.agent.list(params),
    [stigmer],
  );

  return useResourceCount(listFn, org, options);
}
