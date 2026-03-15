"use client";

import { useCallback } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useSessionQueryService } from "@stigmer/session-ui";
import { sessionKeys } from "./keys";

const DEFAULT_PAGE_SIZE = 5;

export interface UseAgentSessionListOptions {
  pageSize?: number;
}

/**
 * Fetches sessions scoped to a specific agent with "load more" infinite
 * pagination.
 *
 * Uses the `listByAgent` RPC which returns sessions where the given agent
 * was used, sorted by creation time descending (most recent first).
 *
 * Refetches automatically when `agentId` changes.
 */
export function useAgentSessionList(
  agentId: string,
  options?: UseAgentSessionListOptions,
) {
  const pageSize = options?.pageSize ?? DEFAULT_PAGE_SIZE;
  const service = useSessionQueryService();

  const query = useInfiniteQuery({
    queryKey: sessionKeys.byAgent(agentId, { pageSize }),
    queryFn: ({ pageParam }) =>
      service.listByAgent({
        agentId,
        pageSize,
        pageToken: pageParam > 0 ? String(pageParam) : "",
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, _allPages, lastPageParam) => {
      if (lastPageParam + 1 >= lastPage.totalPages) return undefined;
      return lastPageParam + 1;
    },
    enabled: !!agentId,
  });

  const sessions = query.data?.pages.flatMap((page) => page.entries) ?? [];

  const loadMore = useCallback(() => {
    query.fetchNextPage();
  }, [query]);

  return {
    sessions,
    isLoading: query.isLoading,
    error: query.error ? (query.error as Error).message : null,
    hasMore: query.hasNextPage ?? false,
    isLoadingMore: query.isFetchingNextPage,
    loadMore,
  };
}
