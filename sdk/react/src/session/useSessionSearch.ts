"use client";

import { useCallback, useRef, useState } from "react";
import type { SearchResult } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { useStigmer } from "../hooks.js";
import { useActiveOrgSlug } from "../organization/OrgProvider.js";
import { useFetch } from "../internal/useFetch.js";

/** Options for {@link useSessionSearch}. */
export interface UseSessionSearchOptions {
  /** Maximum sessions per page. @default 20 */
  readonly pageSize?: number;
}

/** Return value of {@link useSessionSearch}. */
export interface UseSessionSearchReturn {
  /** Current page of session entries (lightweight SearchResult projections). */
  readonly sessions: readonly SearchResult[];
  /** Total number of sessions matching the query. */
  readonly totalCount: number;
  /** Total pages available. */
  readonly totalPages: number;
  /** The current page number (1-indexed). */
  readonly currentPage: number;
  /** `true` while the initial fetch is in flight. */
  readonly isLoading: boolean;
  /** `true` while a background refetch is in flight. */
  readonly isRefetching: boolean;
  /** Error from the last failed request, or `null`. */
  readonly error: Error | null;
  /** Re-fetch the current page. */
  readonly refetch: () => void;
  /** Whether more pages are available. */
  readonly hasMore: boolean;
  /** Load the next page (appends to existing sessions). */
  readonly loadMore: () => void;
}

const DEFAULT_PAGE_SIZE = 20;

interface SessionSearchData {
  sessions: SearchResult[];
  totalCount: number;
  totalPages: number;
  currentPage: number;
}

const INITIAL_DATA: SessionSearchData = {
  sessions: [],
  totalCount: 0,
  totalPages: 0,
  currentPage: 1,
};

/**
 * Data hook that fetches sessions via the SearchService for lightweight,
 * org-scoped, paginated session listing.
 *
 * Unlike {@link useSessionList} which calls the dedicated SessionQueryController.list
 * RPC (loading full session documents with per-session FGA authorization),
 * this hook uses the SearchService which returns lightweight `SearchResult`
 * projections and benefits from the search index's optimized access patterns.
 *
 * Supports incremental "load more" pagination — each call to `loadMore()`
 * fetches the next page and appends results.
 *
 * @example
 * ```tsx
 * function SessionSidebar() {
 *   const { sessions, isLoading, hasMore, loadMore } = useSessionSearch();
 *
 *   return (
 *     <ul>
 *       {sessions.map((s) => <li key={s.id}>{s.description}</li>)}
 *       {hasMore && <button onClick={loadMore}>Load more</button>}
 *     </ul>
 *   );
 * }
 * ```
 */
export function useSessionSearch(
  options?: UseSessionSearchOptions,
): UseSessionSearchReturn {
  const stigmer = useStigmer();
  const org = useActiveOrgSlug();
  const pageSize = options?.pageSize ?? DEFAULT_PAGE_SIZE;

  const [page, setPage] = useState(1);
  const accumulatedRef = useRef<SearchResult[]>([]);

  const pageRef = useRef(page);
  pageRef.current = page;

  const fetchFn = org
    ? async (): Promise<SessionSearchData> => {
        const currentPage = pageRef.current;
        const resp = await stigmer.search.query({
          kinds: [ApiResourceKind.session],
          org,
          page: { num: currentPage, size: pageSize },
        });

        if (currentPage === 1) {
          accumulatedRef.current = [...resp.entries];
        } else {
          accumulatedRef.current = [...accumulatedRef.current, ...resp.entries];
        }

        return {
          sessions: accumulatedRef.current,
          totalCount: resp.totalCount,
          totalPages: resp.totalPages,
          currentPage,
        };
      }
    : null;

  const { data, isLoading, isRefetching, error, refetch } = useFetch(
    fetchFn,
    [org, pageSize, page, stigmer],
    INITIAL_DATA,
  );

  const loadMore = useCallback(() => {
    if (data.currentPage < data.totalPages) {
      setPage((p) => p + 1);
    }
  }, [data.currentPage, data.totalPages]);

  const fullRefetch = useCallback(() => {
    accumulatedRef.current = [];
    setPage(1);
    refetch();
  }, [refetch]);

  return {
    sessions: data.sessions,
    totalCount: data.totalCount,
    totalPages: data.totalPages,
    currentPage: data.currentPage,
    isLoading,
    isRefetching,
    error,
    refetch: fullRefetch,
    hasMore: data.currentPage < data.totalPages,
    loadMore,
  };
}
