"use client";

import { useCallback, useEffect, useState } from "react";

const GITHUB_REPOS_API = "https://api.github.com/user/repos";
const GITHUB_BRANCHES_API = "https://api.github.com/repos";
const PER_PAGE = 30;

/** A GitHub repository from the API. */
export interface GitHubRepo {
  readonly id: number;
  readonly fullName: string;
  readonly name: string;
  readonly owner: string;
  readonly htmlUrl: string;
  readonly cloneUrl: string;
  readonly defaultBranch: string;
  readonly isPrivate: boolean;
  readonly updatedAt: string;
}

/** A GitHub branch from the API. */
export interface GitHubBranch {
  readonly name: string;
}

export interface UseGitHubReposReturn {
  readonly repos: readonly GitHubRepo[];
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly search: string;
  readonly setSearch: (query: string) => void;
  readonly hasMore: boolean;
  readonly loadMore: () => void;
  /** Fetch branches for a specific repo. */
  readonly fetchBranches: (
    owner: string,
    repo: string,
  ) => Promise<GitHubBranch[]>;
}

/**
 * Data hook that fetches the authenticated user's GitHub repositories.
 *
 * Calls the GitHub REST API directly from the browser using the provided
 * access token. Provides pagination, client-side search filtering, and
 * branch fetching for a selected repo.
 */
export function useGitHubRepos(token: string | null): UseGitHubReposReturn {
  const [allRepos, setAllRepos] = useState<GitHubRepo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  const fetchPage = useCallback(
    async (pageNum: number, reset: boolean) => {
      if (!token) return;
      setIsLoading(true);
      setError(null);

      try {
        const url = `${GITHUB_REPOS_API}?sort=pushed&direction=desc&per_page=${PER_PAGE}&page=${pageNum}`;
        const resp = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!resp.ok) {
          throw new Error(`GitHub API error: ${resp.status}`);
        }

        const data = await resp.json();
        const repos: GitHubRepo[] = data.map(
          (r: Record<string, unknown>): GitHubRepo => ({
            id: r.id as number,
            fullName: r.full_name as string,
            name: r.name as string,
            owner: (r.owner as Record<string, unknown>).login as string,
            htmlUrl: r.html_url as string,
            cloneUrl: r.clone_url as string,
            defaultBranch: r.default_branch as string,
            isPrivate: r.private as boolean,
            updatedAt: r.updated_at as string,
          }),
        );

        setAllRepos((prev) => (reset ? repos : [...prev, ...repos]));
        setHasMore(repos.length === PER_PAGE);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to fetch repos");
      } finally {
        setIsLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    if (token) {
      setPage(1);
      setAllRepos([]);
      setHasMore(true);
      fetchPage(1, true);
    } else {
      setAllRepos([]);
    }
  }, [token, fetchPage]);

  const loadMore = useCallback(() => {
    if (!isLoading && hasMore) {
      const next = page + 1;
      setPage(next);
      fetchPage(next, false);
    }
  }, [isLoading, hasMore, page, fetchPage]);

  const filtered = search
    ? allRepos.filter((r) =>
        r.fullName.toLowerCase().includes(search.toLowerCase()),
      )
    : allRepos;

  const fetchBranches = useCallback(
    async (owner: string, repo: string): Promise<GitHubBranch[]> => {
      if (!token) return [];
      try {
        const resp = await fetch(
          `${GITHUB_BRANCHES_API}/${owner}/${repo}/branches?per_page=100`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!resp.ok) return [];
        const data = await resp.json();
        return data.map((b: Record<string, unknown>) => ({
          name: b.name as string,
        }));
      } catch {
        return [];
      }
    },
    [token],
  );

  return {
    repos: filtered,
    isLoading,
    error,
    search,
    setSearch,
    hasMore,
    loadMore,
    fetchBranches,
  };
}
