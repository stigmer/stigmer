"use client";

import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { useResourceCount } from "@stigmer/react-core/internal";

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
 * Reads search's count of the organization's agents for this kind —
 * no agent entries are returned or stored. Useful for
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
  return useResourceCount(ApiResourceKind.agent, org, options);
}
