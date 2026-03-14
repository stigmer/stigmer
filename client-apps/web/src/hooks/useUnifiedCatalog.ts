"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SearchResult } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";
import { type ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { searchCatalog } from "@/services/search-service";
import { useActiveOrgSlug } from "@/contexts/org-context";

const DEBOUNCE_MS = 300;
const DEFAULT_PAGE_SIZE = 20;

export interface UseUnifiedCatalogReturn {
  results: SearchResult[];
  query: string;
  setQuery: (q: string) => void;
  isLoading: boolean;
  error: string | null;
  totalCount: number;
  totalPages: number;
  page: number;
  setPage: (page: number) => void;
  activeKind: ApiResourceKind | null;
  setActiveKind: (kind: ApiResourceKind | null) => void;
  countsByKind: Record<string, number>;
}

/**
 * Unified catalog hook that searches across multiple resource kinds.
 *
 * Manages an active kind filter (null = all kinds), exposes per-kind counts
 * from `SearchResponse.countsByKind`, and supports query debounce + pagination.
 *
 * When a specific kind tab is active, only that kind is searched. The
 * `countsByKind` state retains counts from the last "all kinds" query so
 * tab badges remain populated (standard pattern — GitHub, npm, etc.).
 *
 * Scoped to the active organization via {@link useActiveOrgSlug}.
 */
export function useUnifiedCatalog(): UseUnifiedCatalogReturn {
  const org = useActiveOrgSlug();

  const [query, setQueryState] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [page, setPageState] = useState(1);
  const [activeKind, setActiveKindState] = useState<ApiResourceKind | null>(
    null,
  );
  const [countsByKind, setCountsByKind] = useState<Record<string, number>>({});

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  const executeSearch = useCallback(
    async (
      searchQuery: string,
      pageNum: number,
      kind: ApiResourceKind | null,
    ) => {
      const requestId = ++requestIdRef.current;
      setIsLoading(true);
      setError(null);

      try {
        const response = await searchCatalog({
          kinds: kind != null ? [kind] : [],
          query: searchQuery,
          org,
          page: { num: pageNum, size: DEFAULT_PAGE_SIZE },
        });

        if (requestId !== requestIdRef.current) return;

        setResults(response.entries);
        setTotalCount(response.totalCount);
        setTotalPages(response.totalPages);

        // Merge countsByKind: always update from the response, but when a
        // specific kind is active the response only contains that single kind.
        // We merge into existing state so other tab counts remain visible.
        if (kind == null) {
          setCountsByKind(
            Object.fromEntries(Object.entries(response.countsByKind)),
          );
        } else {
          setCountsByKind((prev) => ({
            ...prev,
            ...Object.fromEntries(Object.entries(response.countsByKind)),
          }));
        }
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
    [org],
  );

  const setQuery = useCallback(
    (q: string) => {
      setQueryState(q);
      setPageState(1);

      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }

      debounceRef.current = setTimeout(() => {
        executeSearch(q, 1, activeKind);
      }, DEBOUNCE_MS);
    },
    [executeSearch, activeKind],
  );

  const setPage = useCallback(
    (p: number) => {
      setPageState(p);
      executeSearch(query, p, activeKind);
    },
    [executeSearch, query, activeKind],
  );

  const setActiveKind = useCallback(
    (kind: ApiResourceKind | null) => {
      setActiveKindState(kind);
      setPageState(1);
      executeSearch(query, 1, kind);
    },
    [executeSearch, query],
  );

  // Refetch when the org changes (and on mount).
  useEffect(() => {
    setQueryState("");
    setPageState(1);
    setActiveKindState(null);
    executeSearch("", 1, null);
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
    activeKind,
    setActiveKind,
    countsByKind,
  };
}
