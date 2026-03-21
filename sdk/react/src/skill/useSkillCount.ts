"use client";

import { useCallback } from "react";
import { useStigmer } from "../hooks";
import { useResourceCount, type ResourceListScope } from "../search";

export interface UseSkillCountOptions {
  /** Text query to filter skills before counting. */
  readonly query?: string;
  /**
   * Controls which skills are counted.
   *
   * - `"org"` — only skills owned by the given organization.
   * - `"all"` — includes public/platform skills.
   *
   * @default "org"
   */
  readonly scope?: ResourceListScope;
}

export interface UseSkillCountReturn {
  /**
   * Total number of skills matching the current filters. `undefined`
   * until the first successful fetch completes.
   */
  readonly count: number | undefined;
  readonly isLoading: boolean;
  readonly error: string | null;
  /** Re-fetch the count with the same parameters. */
  readonly refetch: () => void;
}

/**
 * Data hook that fetches the total count of skills.
 *
 * Issues a minimal `stigmer.skill.list()` call to retrieve only the
 * total count — no skill entries are returned or stored. Useful for
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
 *
 * @example
 * ```tsx
 * // Count all accessible skills including public/platform ones
 * const { count } = useSkillCount("acme", { scope: "all" });
 * ```
 */
export function useSkillCount(
  org: string | null,
  options?: UseSkillCountOptions,
): UseSkillCountReturn {
  const stigmer = useStigmer();

  const listFn = useCallback(
    (params: Parameters<typeof stigmer.skill.list>[0]) =>
      stigmer.skill.list(params),
    [stigmer],
  );

  return useResourceCount(listFn, org, options);
}
