"use client";

import { useCallback } from "react";
import type { SearchResult } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { useResourceList, type ResourceListScope } from "../search/index.js";

/** Options for {@link useDatastoreList}. */
export interface UseDatastoreListOptions {
  /** Maximum datastores per page. @default 20 */
  readonly pageSize?: number;
  /** Page number (1-indexed). @default 1 */
  readonly page?: number;
  /** Text query to filter datastores by name, description, or tags. */
  readonly query?: string;
  /**
   * Controls which datastores are visible.
   *
   * - `"org"` — only datastores owned by the given organization.
   * - `"all"` — includes public/platform datastores.
   *
   * @default "org"
   */
  readonly scope?: ResourceListScope;
}

/** Return value of {@link useDatastoreList}. */
export interface UseDatastoreListReturn {
  /** Paginated datastore entries for the current page. */
  readonly datastores: readonly SearchResult[];
  /** Total number of datastores matching the current filters. */
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
 * Data hook that fetches a paginated list of datastores for the Library.
 *
 * Wraps `stigmer.datastore.list()` (SearchService-backed) with
 * pagination, scope filtering, and text search. All parameters are
 * externally controlled — the consumer manages page state, query
 * debouncing, and scope toggling.
 *
 * Pass `null` as `org` to skip fetching (stable no-op).
 *
 * @example
 * ```tsx
 * const { datastores, totalCount, isLoading } = useDatastoreList("acme", {
 *   page: 1,
 *   pageSize: 20,
 * });
 * ```
 */
export function useDatastoreList(
  org: string | null,
  options?: UseDatastoreListOptions,
): UseDatastoreListReturn {
  const stigmer = useStigmer();

  const listFn = useCallback(
    (params: Parameters<typeof stigmer.datastore.list>[0]) =>
      stigmer.datastore.list(params),
    [stigmer],
  );

  const { entries, totalCount, totalPages, currentPage, isLoading, error, refetch } =
    useResourceList(listFn, org, options);

  return { datastores: entries, totalCount, totalPages, currentPage, isLoading, error, refetch };
}
