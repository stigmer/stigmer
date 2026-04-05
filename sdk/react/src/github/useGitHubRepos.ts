"use client";

import { useCallback, useEffect, useState } from "react";

const GITHUB_REPOS_API = "https://api.github.com/user/repos";
const GITHUB_BRANCHES_API = "https://api.github.com/repos";
const PER_PAGE = 100;

/** A GitHub repository from the API. */
export interface GitHubRepo {
  /** GitHub-assigned numeric repository ID. */
  readonly id: number;
  /** Full repository name including the owner (e.g. `"acme/my-repo"`). */
  readonly fullName: string;
  /** Repository name without the owner prefix. */
  readonly name: string;
  /** Owner login (user or organization). */
  readonly owner: string;
  /** Whether the owner is a personal account or an organization. */
  readonly ownerType: "User" | "Organization";
  /** Web URL for the repository on GitHub. */
  readonly htmlUrl: string;
  /** HTTPS clone URL. */
  readonly cloneUrl: string;
  /** Name of the repository's default branch (e.g. `"main"`). */
  readonly defaultBranch: string;
  /** `true` when the repository is private. */
  readonly isPrivate: boolean;
  /** ISO 8601 timestamp of the last push or update event. */
  readonly updatedAt: string;
}

/** A GitHub branch from the API. */
export interface GitHubBranch {
  /** Branch name (e.g. `"main"`, `"feat/new-feature"`). */
  readonly name: string;
}

/** Return value of {@link useGitHubRepos}. */
export interface UseGitHubReposReturn {
  /** Repositories matching the current client-side search filter. */
  readonly repos: readonly GitHubRepo[];
  /** `true` while the first page is being fetched. */
  readonly isLoading: boolean;
  /** `true` while additional pages are being fetched after the first page. */
  readonly isBackgroundLoading: boolean;
  /** Error message from the last failed fetch, or `null` when healthy. */
  readonly error: string | null;
  /** Current client-side search query. */
  readonly search: string;
  /** Update the client-side search query to filter repos by name. */
  readonly setSearch: (query: string) => void;
  /** Whether more pages may be available. */
  readonly hasMore: boolean;
  /** @deprecated Background pagination loads all pages automatically. */
  readonly loadMore: () => void;
  /** Fetch branches for a specific repository. */
  readonly fetchBranches: (
    owner: string,
    repo: string,
  ) => Promise<GitHubBranch[]>;
}

function parseRepoResponse(r: Record<string, unknown>): GitHubRepo {
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

async function fetchRepoPage(
  token: string,
  page: number,
): Promise<{ repos: GitHubRepo[]; hasMore: boolean }> {
  const url = `${GITHUB_REPOS_API}?sort=pushed&direction=desc&per_page=${PER_PAGE}&page=${page}`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!resp.ok) {
    throw new Error(`GitHub API error: ${resp.status}`);
  }

  const data = await resp.json();
  const repos = (data as Record<string, unknown>[]).map(parseRepoResponse);
  return { repos, hasMore: repos.length === PER_PAGE };
}

/**
 * Data hook that fetches the authenticated user's GitHub repositories.
 *
 * Loads the first page immediately, then eagerly background-fetches
 * remaining pages so client-side search covers the full repo set.
 * Provides client-side search filtering and branch fetching.
 *
 * @example
 * ```tsx
 * function RepoList({ token }: { token: string }) {
 *   const { repos, isLoading, search, setSearch, fetchBranches } =
 *     useGitHubRepos(token);
 *
 *   if (isLoading) return <Skeleton />;
 *
 *   return (
 *     <div>
 *       <input
 *         value={search}
 *         onChange={(e) => setSearch(e.target.value)}
 *         placeholder="Filter repositories…"
 *       />
 *       <ul>
 *         {repos.map((repo) => (
 *           <li key={repo.id}>{repo.fullName}</li>
 *         ))}
 *       </ul>
 *     </div>
 *   );
 * }
 * ```
 *
 * @example
 * ```tsx
 * // Skip fetching until a token is available
 * const { repos } = useGitHubRepos(token ?? null);
 * ```
 */
export function useGitHubRepos(token: string | null): UseGitHubReposReturn {
  const [allRepos, setAllRepos] = useState<GitHubRepo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isBackgroundLoading, setIsBackgroundLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [hasMore, setHasMore] = useState(true);

  useEffect(() => {
    if (!token) {
      setAllRepos([]);
      setIsLoading(false);
      setIsBackgroundLoading(false);
      setHasMore(false);
      return;
    }

    const cancelled = { current: false };

    async function fetchAll() {
      setIsLoading(true);
      setError(null);
      setAllRepos([]);
      setHasMore(true);

      try {
        const first = await fetchRepoPage(token!, 1);
        if (cancelled.current) return;

        setAllRepos(first.repos);
        setIsLoading(false);

        if (!first.hasMore) {
          setHasMore(false);
          return;
        }

        setIsBackgroundLoading(true);
        let page = 2;
        let more = true;

        while (more && !cancelled.current) {
          const result = await fetchRepoPage(token!, page);
          if (cancelled.current) return;
          setAllRepos((prev) => [...prev, ...result.repos]);
          more = result.hasMore;
          page++;
        }

        if (!cancelled.current) {
          setHasMore(false);
          setIsBackgroundLoading(false);
        }
      } catch (e) {
        if (cancelled.current) return;
        setError(e instanceof Error ? e.message : "Failed to fetch repos");
        setIsLoading(false);
        setIsBackgroundLoading(false);
      }
    }

    fetchAll();

    return () => {
      cancelled.current = true;
    };
  }, [token]);

  const loadMore = useCallback(() => {
    // Retained for backwards compatibility. Background pagination
    // fetches all pages automatically after the first page loads.
  }, []);

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
    isBackgroundLoading,
    error,
    search,
    setSearch,
    hasMore,
    loadMore,
    fetchBranches,
  };
}
