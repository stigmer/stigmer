"use client";

import { useCallback } from "react";
import { useStigmer } from "../hooks";
import { useResourceCount, type ResourceListScope } from "../search";

export interface UseAgentCountOptions {
  /** Text query to filter agents before counting. */
  readonly query?: string;
  /**
   * Controls which agents are counted.
   *
   * - `"org"` — only agents owned by the given organization.
   * - `"all"` — includes public/platform agents (e.g. `stigmer/agent-creator`).
   *
   * @default "org"
   */
  readonly scope?: ResourceListScope;
}

export interface UseAgentCountReturn {
  /** Total number of agents matching the current filters. */
  readonly count: number;
  readonly isLoading: boolean;
  readonly error: string | null;
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
 *
 * @example
 * ```tsx
 * // Count all accessible agents including public/platform ones
 * const { count } = useAgentCount("acme", { scope: "all" });
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
