"use client";

import type { SearchResult } from "@stigmer/apis/ai/stigmer/search/v1/io_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { useResourceList } from "@stigmer/react-core/internal";

/** Options for {@link useAgentList}. */
export interface UseAgentListOptions {
  /** Maximum agents per page, the first and each `loadMore`. @default 20 */
  readonly pageSize?: number;
  /** Text query to filter agents by name, description, or tags. */
  readonly query?: string;
}

/** Return value of {@link useAgentList}. */
export interface UseAgentListReturn {
  /** The first page of agents, then every page loaded since. */
  readonly agents: readonly SearchResult[];
  /** `true` while the server holds agents beyond those loaded. */
  readonly hasMore: boolean;
  /** Load the next page. No-op while one is loading or when nothing follows. */
  readonly loadMore: () => void;
  /** `true` while a `loadMore` read is in flight. */
  readonly isLoadingMore: boolean;
  /** Error from the last failed `loadMore`, or `null`. */
  readonly loadMoreError: Error | null;
  /** `true` while the initial fetch is in flight. */
  readonly isLoading: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Re-read the first page; pages loaded since stay. */
  readonly refetch: () => void;
}

/**
 * Data hook that lists an organization's agents for the Library, a page at
 * a time: `stigmer.agent.list()` newest first while `query` is empty,
 * search matches while it holds text. All parameters are externally
 * controlled — the consumer manages query debouncing. A list carries no
 * total; use {@link useAgentCount} for a count.
 *
 * For picker/type-ahead search with internal debouncing and query
 * state management, use {@link useAgentSearch} instead.
 *
 * Pass `null` as `org` to skip fetching (stable no-op).
 *
 * @example
 * ```tsx
 * const { agents, hasMore, loadMore, isLoading } = useAgentList("acme", { pageSize: 20 });
 * ```
 */
export function useAgentList(
  org: string | null,
  options?: UseAgentListOptions,
): UseAgentListReturn {
  const { entries, hasMore, loadMore, isLoadingMore, loadMoreError, isLoading, error, refetch } =
    useResourceList(ApiResourceKind.agent, org, options);

  return { agents: entries, hasMore, loadMore, isLoadingMore, loadMoreError, isLoading, error, refetch };
}
