"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { GitHubRepo } from "./useGitHubRepos.js";

const GITHUB_SEARCH_API = "https://api.github.com/search/repositories";
const DEBOUNCE_MS = 350;
const PER_PAGE = 30;

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
  /** Total number of repositories matching the query across GitHub. */
  readonly totalCount: number;
  /** Whether more result pages are available. */
  readonly hasMore: boolean;
  /** Fetch the next page of results. */
  readonly loadMore: () => void;
}

function parseSearchItem(r: Record<string, unknown>): GitHubRepo {
  const ownerObj = r.owner as Record<string, unknown>;
  return {
    id: r.id as number,
    fullName: r.full_name as string,
    name: r.name as string,
    owner: ownerObj.login as string,
    ownerType:
      (ownerObj.type as string) === "Organization" ? "Organization" : "User",
    htmlUrl: r.html_url as string,
    cloneUrl: r.clone_url as string,
    defaultBranch: r.default_branch as string,
    isPrivate: r.private as boolean,
    updatedAt: r.updated_at as string,
  };
}

async function searchRepos(
  query: string,
  page: number,
  token: string | null,
): Promise<{ repos: GitHubRepo[]; totalCount: number; hasMore: boolean }> {
  const params = new URLSearchParams({
    q: query,
    sort: "stars",
    order: "desc",
    per_page: String(PER_PAGE),
    page: String(page),
  });

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const resp = await fetch(`${GITHUB_SEARCH_API}?${params}`, { headers });

  if (!resp.ok) {
    if (resp.status === 403) {
      throw new Error("GitHub search rate limit exceeded. Try again shortly.");
    }
    throw new Error(`GitHub search error: ${resp.status}`);
  }

  const data = (await resp.json()) as {
    total_count: number;
    items: Record<string, unknown>[];
  };

  const repos = data.items.map(parseSearchItem);
  const totalCount = data.total_count;
  const hasMore = page * PER_PAGE < totalCount;

  return { repos, totalCount, hasMore };
}

/**
 * Data hook that searches GitHub's public repository index.
 *
 * Uses the GitHub Search API (`/search/repositories`) with debounced input.
 * Finds repositories across all of GitHub, not just the user's own repos.
 * Works with or without an auth token (auth: 30 req/min; unauth: 10 req/min).
 *
 * @example
 * ```tsx
 * function GitHubSearch({ token }: { token: string | null }) {
 *   const { results, isSearching, query, setQuery, hasMore, loadMore } =
 *     useGitHubSearch(token);
 *
 *   return (
 *     <div>
 *       <input
 *         value={query}
 *         onChange={(e) => setQuery(e.target.value)}
 *         placeholder="Search all of GitHub…"
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
  token: string | null,
): UseGitHubSearchReturn {
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
    if (!debouncedQuery) return;

    const cancelled = { current: false };

    async function run() {
      setIsSearching(true);
      setError(null);
      try {
        const result = await searchRepos(debouncedQuery, page, token);
        if (cancelled.current) return;
        setResults((prev) =>
          page === 1 ? result.repos : [...prev, ...result.repos],
        );
        setTotalCount(result.totalCount);
        setHasMore(result.hasMore);
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
  }, [debouncedQuery, page, token]);

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
