"use client";

import { useCallback } from "react";
import type { SearchResult } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";
import { useStigmer } from "../hooks";
import { useResourceList, type ResourceListScope } from "../search";

/** Options for {@link useAgentList}. */
export interface UseAgentListOptions {
  /** Maximum agents per page. @default 20 */
  readonly pageSize?: number;
  /** Page number (1-indexed). @default 1 */
  readonly page?: number;
  /** Text query to filter agents by name, description, or tags. */
  readonly query?: string;
  /**
   * Controls which agents are visible.
   *
   * - `"org"` — only agents owned by the given organization.
   * - `"all"` — includes public/platform agents (e.g. `stigmer/agent-creator`).
   *
   * @default "org"
   */
  readonly scope?: ResourceListScope;
}

/** Return value of {@link useAgentList}. */
export interface UseAgentListReturn {
  /** Paginated agent entries for the current page. */
  readonly agents: readonly SearchResult[];
  /** Total number of agents matching the current filters. */
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
 * Data hook that fetches a paginated list of agents for the Library.
 *
 * Wraps `stigmer.agent.list()` with pagination, scope filtering,
 * and text search. All parameters are externally controlled — the
 * consumer manages page state, query debouncing, and scope toggling.
 *
 * For picker/type-ahead search with internal debouncing and query
 * state management, use {@link useAgentSearch} instead.
 *
 * Pass `null` as `org` to skip fetching (stable no-op).
 *
 * @example
 * ```tsx
 * const { agents, totalCount, isLoading } = useAgentList("acme", {
 *   page: 1,
 *   pageSize: 20,
 *   scope: "org",
 * });
 * ```
 *
 * @example
 * ```tsx
 * // Show all agents including public/platform ones
 * const { agents } = useAgentList("acme", { scope: "all" });
 * ```
 */
export function useAgentList(
  org: string | null,
  options?: UseAgentListOptions,
): UseAgentListReturn {
  const stigmer = useStigmer();

  const listFn = useCallback(
    (params: Parameters<typeof stigmer.agent.list>[0]) =>
      stigmer.agent.list(params),
    [stigmer],
  );

  const { entries, totalCount, totalPages, currentPage, isLoading, error, refetch } =
    useResourceList(listFn, org, options);

  return { agents: entries, totalCount, totalPages, currentPage, isLoading, error, refetch };
}
