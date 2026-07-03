"use client";

import { useEffect, useState } from "react";
import type { ListParams, ListResult } from "@stigmer/sdk";
import type { SearchResult } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";
import { useFetch } from "../internal/useFetch.js";

/** Shared options for resource search hooks (`useAgentSearch`, `useMcpServerSearch`, `useSkillSearch`). */
export interface UseResourceSearchOptions {
  /** Maximum results per page. @default 30 */
  readonly pageSize?: number;
  /** Debounce delay for query changes in milliseconds. @default 300 */
  readonly debounceMs?: number;
  /**
   * Controls search scope.
   *
   * - `"org"` — search only within the provided organization.
   * - `"all"` — search within the provided organization plus public
   *   resources from other organizations.
   *
   * @default "org"
   */
  readonly scope?: "org" | "all";
}

/** Shared return value for resource search hooks (`useAgentSearch`, `useMcpServerSearch`, `useSkillSearch`). */
export interface UseResourceSearchReturn {
  /** Matching resources from the most recent search. */
  readonly results: readonly SearchResult[];
  /** `true` while a search request is in flight. */
  readonly isLoading: boolean;
  /** `true` while a background refetch is in flight. */
  readonly isRefetching: boolean;
  /** Error from the last failed search, or `null` when healthy. */
  readonly error: Error | null;
  /** Current search query text. */
  readonly query: string;
  /** Update the search query (triggers a debounced re-search). */
  readonly setQuery: (query: string) => void;
  /** Re-run the current search with the same parameters. */
  readonly refetch: () => void;
}

const DEFAULT_PAGE_SIZE = 30;
const DEFAULT_DEBOUNCE_MS = 300;

/**
 * Internal hook that powers both `useMcpServerSearch` and `useSkillSearch`.
 *
 * Wraps a `ListParams -> ListResult` function with query state management,
 * debounced search, loading/error tracking, and cancellation-safe fetching.
 *
 * Not exported from the public API — consumers use the resource-specific
 * hooks (`useMcpServerSearch`, `useSkillSearch`) instead.
 */
export function useResourceSearch(
  listFn: (params: ListParams) => Promise<ListResult>,
  org: string,
  options?: UseResourceSearchOptions,
): UseResourceSearchReturn {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  const pageSize = options?.pageSize ?? DEFAULT_PAGE_SIZE;
  const debounceMs = options?.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const scope = options?.scope ?? "org";

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), debounceMs);
    return () => clearTimeout(timer);
  }, [query, debounceMs]);

  const { data: results, isLoading, isRefetching, error, refetch } = useFetch<SearchResult[]>(
    async () => {
      const params: ListParams = {
        org,
        query: debouncedQuery || undefined,
        excludePublic: false,
        crossOrgPublic: scope === "all",
        page: { num: 1, size: pageSize },
      };
      const result = await listFn(params);
      return [...result.entries];
    },
    [listFn, org, debouncedQuery, pageSize, scope],
    [],
  );

  return { results, isLoading, isRefetching, error, query, setQuery, refetch };
}
