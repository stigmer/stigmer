"use client";

import { useMemo } from "react";
import type { SearchResult } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { useStigmer } from "../hooks.js";
import { useActiveOrgId } from "../organization/OrgProvider.js";
import { useCursorPages } from "../internal/useCursorPages.js";

/** Options for {@link useSessionSearch}. */
export interface UseSessionSearchOptions {
  /** Maximum sessions per page. @default 20 */
  readonly pageSize?: number;
}

/** Return value of {@link useSessionSearch}. */
export interface UseSessionSearchReturn {
  /** The first page of sessions, then every page loaded since (lightweight SearchResult projections). */
  readonly sessions: readonly SearchResult[];
  /** `true` while the initial fetch is in flight. */
  readonly isLoading: boolean;
  /** `true` while a background refetch is in flight. */
  readonly isRefetching: boolean;
  /** Error from the last failed request, or `null`. */
  readonly error: Error | null;
  /** Re-read the first page; pages loaded since stay. */
  readonly refetch: () => void;
  /** Whether more pages are available. */
  readonly hasMore: boolean;
  /** Load the next page (appends to existing sessions). */
  readonly loadMore: () => void;
  /** `true` while a `loadMore` read is in flight. */
  readonly isLoadingMore: boolean;
  /** Error from the last failed `loadMore`, or `null`. */
  readonly loadMoreError: Error | null;
}

const DEFAULT_PAGE_SIZE = 20;

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
 * follows the search's page token and appends results. A list carries no
 * total.
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
  const org = useActiveOrgId();
  const pageSize = options?.pageSize ?? DEFAULT_PAGE_SIZE;

  const pages = useCursorPages<SearchResult>(
    org
      ? (pageToken) =>
          stigmer.search.query({
            kinds: [ApiResourceKind.session],
            org,
            pageSize,
            pageToken,
          })
      : null,
    [org, pageSize, stigmer],
    (row) => row.id,
  );

  const { items, isLoading, isRefetching, error, refetch, hasMore, loadMore, isLoadingMore, loadMoreError } = pages;
  return useMemo(
    () => ({ sessions: items, isLoading, isRefetching, error, refetch, hasMore, loadMore, isLoadingMore, loadMoreError }),
    [items, isLoading, isRefetching, error, refetch, hasMore, loadMore, isLoadingMore, loadMoreError],
  );
}
