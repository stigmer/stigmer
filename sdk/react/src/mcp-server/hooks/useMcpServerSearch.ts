"use client";

import { useEffect, useRef, useState } from "react";
import { useStigmer } from "../../hooks";
import type { SearchResult } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";

const DEBOUNCE_MS = 300;
const DEFAULT_PAGE_SIZE = 20;

export interface UseMcpServerSearchOptions {
  org: string;
  debounceMs?: number;
  pageSize?: number;
}

export interface UseMcpServerSearchReturn {
  query: string;
  setQuery: (query: string) => void;
  results: SearchResult[];
  isLoading: boolean;
  error: string | null;
}

/**
 * Debounced MCP server search scoped to a specific organization.
 *
 * On mount fetches all accessible MCP servers (empty query). Typing fires at
 * most one request per debounce interval. Stale responses from out-of-order
 * requests are discarded.
 *
 * Returns full {@link SearchResult} objects suitable for use with
 * `ResourceSearchCard`.
 */
export function useMcpServerSearch(options: UseMcpServerSearchOptions): UseMcpServerSearchReturn {
  const { org, debounceMs = DEBOUNCE_MS, pageSize = DEFAULT_PAGE_SIZE } = options;
  const stigmer = useStigmer();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const latestRequestId = useRef(0);
  const debouncedQuery = useDebouncedValue(query, debounceMs);

  useEffect(() => {
    const requestId = ++latestRequestId.current;
    setIsLoading(true);
    setError(null);

    stigmer.mcpServer
      .list({ query: debouncedQuery, org, page: { num: 1, size: pageSize } })
      .then((response) => {
        if (requestId !== latestRequestId.current) return;
        setResults(response.entries);
      })
      .catch((err: unknown) => {
        if (requestId !== latestRequestId.current) return;
        setError(err instanceof Error ? err.message : "Search failed");
      })
      .finally(() => {
        if (requestId !== latestRequestId.current) return;
        setIsLoading(false);
      });
  }, [debouncedQuery, org, pageSize, stigmer]);

  return { query, setQuery, results, isLoading, error };
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
