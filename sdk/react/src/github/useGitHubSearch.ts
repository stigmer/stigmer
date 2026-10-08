"use client";

/**
 * Repository search for the connected GitHub account, through the server's
 * GitHub query RPCs with the login saved in My vault: the page never holds
 * the token or calls api.github.com.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useStigmer } from "../hooks.js";
import { toGitHubRepo, type GitHubRepo } from "./useGitHubRepos.js";

const DEBOUNCE_MS = 350;

/** Return value of {@link useGitHubSearch}. */
export interface UseGitHubSearchReturn {
  /** Search results for the current debounced query. */
  readonly results: readonly GitHubRepo[];
  /** `true` while the search request is in flight. */
  readonly isSearching: boolean;
  /** Error message from the last failed search, or `null` when healthy. */
  readonly error: string | null;
  /** Current raw search query (not debounced). */
  readonly query: string;
  /** Update the search query. The actual API call is debounced internally. */
  readonly setQuery: (query: string) => void;
  /** Number of matching repositories loaded so far. */
  readonly totalCount: number;
  /** Whether more result pages are available. */
  readonly hasMore: boolean;
  /** Fetch the next page of results. */
  readonly loadMore: () => void;
}

/**
 * Data hook that searches the repositories the connected GitHub account can
 * reach, with debounced input. Pass `null` (GitHub not connected) to skip.
 *
 * @example
 * ```tsx
 * function GitHubSearch({ org }: { org: string | null }) {
 *   const { results, isSearching, query, setQuery, hasMore, loadMore } =
 *     useGitHubSearch(org);
 *
 *   return (
 *     <div>
 *       <input
 *         value={query}
 *         onChange={(e) => setQuery(e.target.value)}
 *         placeholder="Search repositories…"
 *       />
 *       {isSearching && <Spinner />}
 *       <ul>
 *         {results.map((repo) => (
 *           <li key={repo.id}>{repo.fullName}</li>
 *         ))}
 *       </ul>
 *       {hasMore && <button onClick={loadMore}>Load more</button>}
 *     </div>
 *   );
 * }
 * ```
 */
export function useGitHubSearch(
  org: string | null,
): UseGitHubSearchReturn {
  const stigmer = useStigmer();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [results, setResults] = useState<GitHubRepo[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const debounceTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    clearTimeout(debounceTimer.current);
    if (!query.trim()) {
      setDebouncedQuery("");
      setResults([]);
      setTotalCount(0);
      setHasMore(false);
      setError(null);
      return;
    }
    debounceTimer.current = setTimeout(() => {
      setDebouncedQuery(query.trim());
      setPage(1);
    }, DEBOUNCE_MS);
    return () => clearTimeout(debounceTimer.current);
  }, [query]);

  useEffect(() => {
    if (!debouncedQuery || !org) return;

    const cancelled = { current: false };

    async function run() {
      setIsSearching(true);
      setError(null);
      try {
        const list = await stigmer.github.searchRepositories({
          org: org!,
          query: debouncedQuery,
          page,
        });
        if (cancelled.current) return;
        const repos = list.repositories.map(toGitHubRepo);
        setResults((prev) => {
          const next = page === 1 ? repos : [...prev, ...repos];
          setTotalCount(next.length);
          return next;
        });
        setHasMore(list.hasMore);
      } catch (e) {
        if (cancelled.current) return;
        setError(e instanceof Error ? e.message : "Search failed");
      } finally {
        if (!cancelled.current) setIsSearching(false);
      }
    }

    run();
    return () => {
      cancelled.current = true;
    };
  }, [debouncedQuery, page, org, stigmer]);

  const loadMore = useCallback(() => {
    if (hasMore && !isSearching) {
      setPage((prev) => prev + 1);
    }
  }, [hasMore, isSearching]);

  return {
    results,
    isSearching,
    error,
    query,
    setQuery,
    totalCount,
    hasMore,
    loadMore,
  };
}
