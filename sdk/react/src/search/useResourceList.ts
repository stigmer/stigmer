"use client";

import { useMemo } from "react";
import type { SearchResult } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { useCursorPages } from "../internal/useCursorPages.js";
import { createLibraryListFn, type LibraryKind } from "./librarySource.js";

export interface UseResourceListOptions {
  /** Maximum results per page, the first and each `loadMore`. @default 20 */
  readonly pageSize?: number;
  /** Text query to filter results. No debouncing is applied — the consumer controls timing. */
  readonly query?: string;
}

export interface UseResourceListReturn {
  /** The first page, then every page loaded since. */
  readonly entries: readonly SearchResult[];
  /** `true` while the server holds entries beyond those loaded. */
  readonly hasMore: boolean;
  /** Load the next page. No-op while one is loading or when nothing follows. */
  readonly loadMore: () => void;
  /** `true` while a `loadMore` read is in flight. */
  readonly isLoadingMore: boolean;
  /** Error from the last failed `loadMore`, or `null`. */
  readonly loadMoreError: Error | null;
  readonly isLoading: boolean;
  readonly isRefetching: boolean;
  readonly error: Error | null;
  readonly refetch: () => void;
}

const DEFAULT_PAGE_SIZE = 20;

/**
 * Internal hook that provides token-paged resource listing over one
 * organization's rows (what the caller may read there; the server applies
 * the read scope, never the client): the kind's `list` while `query` is
 * empty, its search matches while `query` holds text, through the Library
 * source (`createLibraryListFn`). Pages accumulate with `loadMore`; a list
 * carries no total.
 *
 * Powers the public resource list hooks (`useAgentList`, `useSkillList`,
 * `usePluginList`) — not exported from the public API.
 *
 * Unlike {@link useResourceSearch} which manages its own debounced query
 * state for picker/type-ahead UX, this hook accepts all parameters
 * externally, giving the consumer full control over query timing.
 */
export function useResourceList(
  kind: LibraryKind,
  org: string | null,
  options?: UseResourceListOptions,
): UseResourceListReturn {
  const stigmer = useStigmer();
  const pageSize = options?.pageSize ?? DEFAULT_PAGE_SIZE;
  const query = options?.query ?? "";
  const listFn = useMemo(() => createLibraryListFn(stigmer, kind), [stigmer, kind]);

  const pages = useCursorPages<SearchResult>(
    org
      ? (pageToken) => listFn({ org, query: query || undefined, pageSize, pageToken })
      : null,
    [listFn, org, query, pageSize],
    (row) => row.id,
  );

  return {
    entries: pages.items,
    hasMore: pages.hasMore,
    loadMore: pages.loadMore,
    isLoadingMore: pages.isLoadingMore,
    loadMoreError: pages.loadMoreError,
    isLoading: pages.isLoading,
    isRefetching: pages.isRefetching,
    error: pages.error,
    refetch: pages.refetch,
  };
}
