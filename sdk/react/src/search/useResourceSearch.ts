"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ListParams, ListResult } from "@stigmer/sdk";
import type { SearchResult } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";

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

export interface UseResourceSearchReturn {
  readonly results: readonly SearchResult[];
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly query: string;
  readonly setQuery: (query: string) => void;
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
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [fetchKey, setFetchKey] = useState(0);

  const pageSize = options?.pageSize ?? DEFAULT_PAGE_SIZE;
  const debounceMs = options?.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const scope = options?.scope ?? "org";

  // Debounce query changes
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), debounceMs);
    return () => clearTimeout(timer);
  }, [query, debounceMs]);

  const refetch = useCallback(() => setFetchKey((k) => k + 1), []);

  useEffect(() => {
    const cancelled = { current: false };
    setIsLoading(true);
    setError(null);

    const params: ListParams = {
      org,
      query: debouncedQuery || undefined,
      excludePublic: false,
      crossOrgPublic: scope === "all",
      page: { num: 1, size: pageSize },
    };

    listFn(params).then(
      (result) => {
        if (cancelled.current) return;
        setResults([...result.entries]);
        setIsLoading(false);
      },
      (err) => {
        if (cancelled.current) return;
        setError(
          err instanceof Error ? err.message : "Failed to load resources",
        );
        setIsLoading(false);
      },
    );

    return () => {
      cancelled.current = true;
    };
  }, [listFn, org, debouncedQuery, pageSize, scope, fetchKey]);

  return { results, isLoading, error, query, setQuery, refetch };
}
