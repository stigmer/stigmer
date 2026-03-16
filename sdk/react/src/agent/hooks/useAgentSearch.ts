"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useStigmer } from "../../hooks.js";
import type { SearchResult } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";

const DEBOUNCE_MS = 300;
const DEFAULT_PAGE_SIZE = 20;

export interface AgentSearchResult {
  id: string;
  name: string;
  qualifiedSlug: string;
  org: string;
  description: string;
}

export interface UseAgentSearchOptions {
  org: string;
  debounceMs?: number;
  pageSize?: number;
}

export interface UseAgentSearchReturn {
  query: string;
  setQuery: (query: string) => void;
  results: AgentSearchResult[];
  isLoading: boolean;
  error: string | null;
}

function toAgentSearchResult(r: SearchResult): AgentSearchResult {
  return {
    id: r.id,
    name: r.name,
    qualifiedSlug: r.qualifiedSlug,
    org: r.org,
    description: r.description,
  };
}

/**
 * Debounced agent search scoped to a specific organization.
 *
 * On mount fetches all accessible agents (empty query). Typing fires at most
 * one request per debounce interval. Stale responses from out-of-order
 * requests are discarded.
 */
export function useAgentSearch(options: UseAgentSearchOptions): UseAgentSearchReturn {
  const { org, debounceMs = DEBOUNCE_MS, pageSize = DEFAULT_PAGE_SIZE } = options;
  const stigmer = useStigmer();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AgentSearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const latestRequestId = useRef(0);
  const debouncedQuery = useDebouncedValue(query, debounceMs);

  useEffect(() => {
    const requestId = ++latestRequestId.current;
    setIsLoading(true);
    setError(null);

    stigmer.agent
      .list({ query: debouncedQuery, org, page: { num: 1, size: pageSize } })
      .then((response) => {
        if (requestId !== latestRequestId.current) return;
        setResults(response.entries.map(toAgentSearchResult));
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
