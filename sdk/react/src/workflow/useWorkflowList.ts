"use client";

import { useCallback } from "react";
import type { SearchResult } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { useResourceList, type ResourceListScope } from "../search/index.js";

/** Options for {@link useWorkflowList}. */
export interface UseWorkflowListOptions {
  /** Maximum workflows per page. @default 20 */
  readonly pageSize?: number;
  /** Page number (1-indexed). @default 1 */
  readonly page?: number;
  /** Text query to filter workflows by name, description, or tags. */
  readonly query?: string;
  /**
   * Controls which workflows are visible.
   *
   * - `"org"` — only workflows owned by the given organization.
   * - `"all"` — includes public/platform workflows.
   *
   * @default "org"
   */
  readonly scope?: ResourceListScope;
}

/** Return value of {@link useWorkflowList}. */
export interface UseWorkflowListReturn {
  /** Paginated workflow entries for the current page. */
  readonly workflows: readonly SearchResult[];
  /** Total number of workflows matching the current filters. */
  readonly totalCount: number;
  /** Total pages available at the current page size. */
  readonly totalPages: number;
  /** The current page number (mirrors the `page` option). */
  readonly currentPage: number;
  /** `true` while the initial fetch or a refetch is in flight. */
  readonly isLoading: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch the current page from the server. */
  readonly refetch: () => void;
}

/**
 * Data hook that fetches a paginated list of workflows for the Workflows section.
 *
 * Wraps `stigmer.workflow.list()` with pagination, scope filtering,
 * and text search. All parameters are externally controlled — the
 * consumer manages page state, query debouncing, and scope toggling.
 *
 * Pass `null` as `org` to skip fetching (stable no-op).
 *
 * @example
 * ```tsx
 * const { workflows, totalCount, isLoading } = useWorkflowList("acme", {
 *   page: 1,
 *   pageSize: 20,
 *   scope: "org",
 * });
 * ```
 */
export function useWorkflowList(
  org: string | null,
  options?: UseWorkflowListOptions,
): UseWorkflowListReturn {
  const stigmer = useStigmer();

  const listFn = useCallback(
    (params: Parameters<typeof stigmer.workflow.list>[0]) =>
      stigmer.workflow.list(params),
    [stigmer],
  );

  const { entries, totalCount, totalPages, currentPage, isLoading, error, refetch } =
    useResourceList(listFn, org, options);

  return { workflows: entries, totalCount, totalPages, currentPage, isLoading, error, refetch };
}
