"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SearchResult } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";
import { searchAgents } from "@/services/search-service";
import { useActiveOrgSlug } from "@/contexts/org-context";

const DEBOUNCE_MS = 300;
const DEFAULT_PAGE_SIZE = 20;

export interface UseAgentSearchReturn {
  /** Current search query text. */
  query: string;
  /** Update the query — triggers a debounced search. */
  setQuery: (q: string) => void;
  /** Agent search results for the current query. */
  results: SearchResult[];
  /** True while a search request is in flight. */
  isLoading: boolean;
  /** Error message from the last failed search. Null when healthy. */
  error: string | null;
  /** Total number of matching agents across all pages. */
  totalCount: number;
}

/**
 * Debounced agent search hook scoped to the active organization.
 *
 * On mount, fetches a default list (empty query = all accessible agents,
 * sorted by creation date). Subsequent calls to `setQuery` trigger a
 * debounced search after {@link DEBOUNCE_MS}ms of inactivity.
 *
 * Refetches automatically when the user switches orgs.
 *
 * Stale responses are discarded — only the latest request's results are
 * applied to state.
 */
export function useAgentSearch(): UseAgentSearchReturn {
  const org = useActiveOrgSlug();

  const [query, setQueryState] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  const executeSearch = useCallback(
    async (searchQuery: string) => {
      const requestId = ++requestIdRef.current;
      setIsLoading(true);
      setError(null);

      try {
        const response = await searchAgents({
          query: searchQuery,
          org,
          page: { num: 1, size: DEFAULT_PAGE_SIZE },
        });

        if (requestId !== requestIdRef.current) return;

        setResults(response.entries);
        setTotalCount(response.totalCount);
      } catch (err: unknown) {
        if (requestId !== requestIdRef.current) return;

        const message =
          err instanceof Error ? err.message : "Failed to search agents";
        setError(message);
        setResults([]);
        setTotalCount(0);
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

      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }

      debounceRef.current = setTimeout(() => {
        executeSearch(q);
      }, DEBOUNCE_MS);
    },
    [executeSearch],
  );

  // Refetch when the org changes (and on mount).
  useEffect(() => {
    setQueryState("");
    executeSearch("");
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [executeSearch]);

  return { query, setQuery, results, isLoading, error, totalCount };
}
