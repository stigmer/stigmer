"use client";

import { useEffect, useMemo, useState } from "react";
import type { SearchResult } from "@stigmer/apis/ai/stigmer/search/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";
import { createLibraryListFn, type LibraryKind } from "./librarySource.js";

/** Shared options for resource search hooks (`useAgentSearch`, `usePluginSearch`, `useSkillSearch`). */
export interface UseResourceSearchOptions {
  /** Maximum results per page. @default 30 */
  readonly pageSize?: number;
  /** Debounce delay for query changes in milliseconds. @default 300 */
  readonly debounceMs?: number;
}

/** Shared return value for resource search hooks (`useAgentSearch`, `usePluginSearch`, `useSkillSearch`). */
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
 * Internal hook that powers `useAgentSearch`, `usePluginSearch` and
 * `useSkillSearch`.
 *
 * Adds query state, a debounce, loading/error tracking and
 * cancellation-safe fetching to the Library source for one kind: the
 * kind's newest while nothing is typed, its search matches once something
 * is. A picker shows the first page; a person narrows it by typing.
 *
 * Not exported from the public API — consumers use the resource-specific
 * hooks (`usePluginSearch`, `useSkillSearch`) instead.
 */
export function useResourceSearch(
  kind: LibraryKind,
  org: string,
  options?: UseResourceSearchOptions,
): UseResourceSearchReturn {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  const pageSize = options?.pageSize ?? DEFAULT_PAGE_SIZE;
  const debounceMs = options?.debounceMs ?? DEFAULT_DEBOUNCE_MS;

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), debounceMs);
    return () => clearTimeout(timer);
  }, [query, debounceMs]);

  const stigmer = useStigmer();
  const listFn = useMemo(() => createLibraryListFn(stigmer, kind), [stigmer, kind]);

  const { data: results, isLoading, isRefetching, error, refetch } = useFetch<SearchResult[]>(
    async () => {
      const page = await listFn({
        org,
        query: debouncedQuery || undefined,
        pageSize,
        pageToken: "",
      });
      return [...page.entries];
    },
    [listFn, org, debouncedQuery, pageSize],
    [],
  );

  return { results, isLoading, isRefetching, error, query, setQuery, refetch };
}
