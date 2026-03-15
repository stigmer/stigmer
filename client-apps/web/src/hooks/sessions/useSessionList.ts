"use client";

import { useCallback } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useSessionQueryService } from "@stigmer/session-ui";
import { sessionKeys } from "./keys";

const DEFAULT_PAGE_SIZE = 20;

export interface UseSessionListOptions {
  pageSize?: number;
}

/**
 * Fetches the authenticated user's session list with cursor-based
 * infinite pagination ("load more").
 *
 * The server scopes results to the caller's identity via the Bearer
 * token, so no org parameter is needed.
 */
export function useSessionList(options?: UseSessionListOptions) {
  const pageSize = options?.pageSize ?? DEFAULT_PAGE_SIZE;
  const service = useSessionQueryService();

  const query = useInfiniteQuery({
    queryKey: sessionKeys.list({ pageSize }),
    queryFn: ({ pageParam }) =>
      service.list({
        pageSize,
        pageToken: pageParam > 0 ? String(pageParam) : "",
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, _allPages, lastPageParam) => {
      if (lastPageParam + 1 >= lastPage.totalPages) return undefined;
      return lastPageParam + 1;
    },
  });

  const sessions = query.data?.pages.flatMap((page) => page.entries) ?? [];

  const loadMore = useCallback(() => {
    query.fetchNextPage();
  }, [query]);

  const refresh = useCallback(() => {
    query.refetch();
  }, [query]);

  return {
    sessions,
    isLoading: query.isLoading,
    error: (query.error as Error | null) ?? null,
    hasMore: query.hasNextPage ?? false,
    isLoadingMore: query.isFetchingNextPage,
    loadMore,
    refresh,
  };
}
