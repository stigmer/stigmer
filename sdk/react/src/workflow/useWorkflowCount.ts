"use client";

import { useCallback } from "react";
import { useStigmer } from "../hooks.js";
import { useResourceCount, type ResourceListScope } from "../search/index.js";

/** Options for {@link useWorkflowCount}. */
export interface UseWorkflowCountOptions {
  /** Text query to filter workflows before counting. */
  readonly query?: string;
  /**
   * Controls which workflows are counted.
   *
   * - `"org"` — only workflows owned by the given organization.
   * - `"all"` — includes public/platform workflows.
   *
   * @default "org"
   */
  readonly scope?: ResourceListScope;
  /** Opaque token that forces a recount when its value changes. */
  readonly refetchToken?: unknown;
}

/** Return value of {@link useWorkflowCount}. */
export interface UseWorkflowCountReturn {
  /**
   * Total number of workflows matching the current filters. `undefined`
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
 * Data hook that fetches the total count of workflows.
 *
 * Issues a minimal `stigmer.workflow.list()` call to retrieve only the
 * total count — no workflow entries are returned or stored. Useful for
 * summary cards, badges, and dashboard widgets.
 *
 * For the full paginated workflow list, use {@link useWorkflowList} instead.
 *
 * Pass `null` as `org` to skip fetching (stable no-op).
 *
 * @example
 * ```tsx
 * const { count, isLoading } = useWorkflowCount("acme");
 * ```
 */
export function useWorkflowCount(
  org: string | null,
  options?: UseWorkflowCountOptions,
): UseWorkflowCountReturn {
  const stigmer = useStigmer();

  const listFn = useCallback(
    (params: Parameters<typeof stigmer.workflow.list>[0]) =>
      stigmer.workflow.list(params),
    [stigmer],
  );

  return useResourceCount(listFn, org, options);
}
