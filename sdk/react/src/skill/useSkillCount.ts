"use client";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { useResourceCount } from "../search/index.js";

/** Options for {@link useSkillCount}. */
export interface UseSkillCountOptions {
  /** Text query to filter skills before counting. */
  readonly query?: string;
  /** Opaque token that forces a recount when its value changes. */
  readonly refetchToken?: unknown;
}

/** Return value of {@link useSkillCount}. */
export interface UseSkillCountReturn {
  /**
   * Total number of skills matching the current filters. `undefined`
   * until the first successful fetch completes.
   */
  readonly count: number | undefined;
  /** `true` while the count fetch is in flight. */
  readonly isLoading: boolean;
  /** Error message from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch the count from the server. */
  readonly refetch: () => void;
}

/**
 * Data hook that fetches the total count of skills.
 *
 * Reads search's count of the organization's skills for this kind —
 * no skill entries are returned or stored. Useful for
 * summary cards, badges, and dashboard widgets.
 *
 * For the full paginated skill list, use {@link useSkillList} instead.
 *
 * Pass `null` as `org` to skip fetching (stable no-op).
 *
 * @example
 * ```tsx
 * const { count, isLoading } = useSkillCount("acme");
 * ```
 */
export function useSkillCount(
  org: string | null,
  options?: UseSkillCountOptions,
): UseSkillCountReturn {
  return useResourceCount(ApiResourceKind.skill, org, options);
}
