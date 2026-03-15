"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SearchResult } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";
import { type ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { searchResources } from "@/services/search-service";
import { useActiveOrgSlug } from "@/contexts/org-context";

const DEBOUNCE_MS = 300;
const DEFAULT_PAGE_SIZE = 20;

export interface UseResourceCatalogReturn {
  results: SearchResult[];
  query: string;
  setQuery: (q: string) => void;
  isLoading: boolean;
  error: string | null;
  totalCount: number;
  totalPages: number;
  page: number;
  setPage: (page: number) => void;
}

/**
 * Generic catalog hook for any searchable resource kind.
 *
 * Scoped to the active organization from {@link useActiveOrgSlug}. When the
 * user switches orgs the results refetch automatically.
 *
 * On mount, fetches the default list (empty query). Subsequent calls to
 * `setQuery` trigger a debounced search. `setPage` navigates between pages
 * immediately (no debounce).
 *
 * Stale responses are discarded via requestIdRef.
 */
export function useResourceCatalog(
  kind: ApiResourceKind,
): UseResourceCatalogReturn {
  const org = useActiveOrgSlug();

  const [query, setQueryState] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [page, setPageState] = useState(1);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  const executeSearch = useCallback(
    async (searchQuery: string, pageNum: number) => {
      const requestId = ++requestIdRef.current;
      setIsLoading(true);
      setError(null);

      try {
        const response = await searchResources(kind, {
          query: searchQuery,
          org,
          page: { num: pageNum, size: DEFAULT_PAGE_SIZE },
        });

        if (requestId !== requestIdRef.current) return;

        setResults(response.entries);
        setTotalCount(response.totalCount);
        setTotalPages(response.totalPages);
      } catch (err: unknown) {
        if (requestId !== requestIdRef.current) return;

        const message =
          err instanceof Error ? err.message : "Failed to load resources";
        setError(message);
        setResults([]);
        setTotalCount(0);
        setTotalPages(0);
      } finally {
        if (requestId === requestIdRef.current) {
          setIsLoading(false);
        }
      }
    },
    [kind, org],
  );

  const setQuery = useCallback(
    (q: string) => {
      setQueryState(q);
      setPageState(1);

      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }

      debounceRef.current = setTimeout(() => {
        executeSearch(q, 1);
      }, DEBOUNCE_MS);
    },
    [executeSearch],
  );

  const setPage = useCallback(
    (p: number) => {
      setPageState(p);
      executeSearch(query, p);
    },
    [executeSearch, query],
  );

  // Refetch when the org changes (and on mount).
  useEffect(() => {
    setQueryState("");
    setPageState(1);
    executeSearch("", 1);
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [executeSearch]);

  return {
    results,
    query,
    setQuery,
    isLoading,
    error,
    totalCount,
    totalPages,
    page,
    setPage,
  };
}
