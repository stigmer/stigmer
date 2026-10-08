"use client";

/**
 * The connected GitHub account's repositories and branches, read through
 * the server's GitHub query RPCs with the login saved in My vault. The
 * page never holds the token or calls api.github.com.
 */
import { useCallback, useEffect, useState } from "react";
import type { Stigmer } from "@stigmer/sdk";
import type { GitHubRepository } from "@stigmer/protos/ai/stigmer/platform/github/v1/io_pb";
import { useStigmer } from "../hooks.js";

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

/** The console's repository shape, from the server's GitHub repository message. */
export function toGitHubRepo(r: GitHubRepository): GitHubRepo {
  return {
    id: Number(r.id),
    fullName: r.fullName,
    name: r.name,
    owner: r.owner,
    ownerType: r.ownerIsOrganization ? "Organization" : "User",
    htmlUrl: r.htmlUrl,
    cloneUrl: r.cloneUrl,
    defaultBranch: r.defaultBranch,
    isPrivate: r.isPrivate,
    updatedAt: r.updatedAt,
  };
}

async function fetchRepoPage(
  stigmer: Stigmer,
  org: string,
  page: number,
): Promise<{ repos: GitHubRepo[]; hasMore: boolean }> {
  const list = await stigmer.github.listRepositories({ org, page });
  return { repos: list.repositories.map(toGitHubRepo), hasMore: list.hasMore };
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
 * function RepoList({ org }: { org: string }) {
 *   const { repos, isLoading, search, setSearch, fetchBranches } =
 *     useGitHubRepos(org);
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
 * // Skip fetching until GitHub is connected
 * const { repos } = useGitHubRepos(gitHubConnection.readOrg);
 * ```
 */
export function useGitHubRepos(org: string | null): UseGitHubReposReturn {
  const stigmer = useStigmer();
  const [allRepos, setAllRepos] = useState<GitHubRepo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isBackgroundLoading, setIsBackgroundLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [hasMore, setHasMore] = useState(true);

  useEffect(() => {
    if (!org) {
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
        const first = await fetchRepoPage(stigmer, org!, 1);
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
          const result = await fetchRepoPage(stigmer, org!, page);
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
  }, [org, stigmer]);

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
      if (!org) return [];
      try {
        const list = await stigmer.github.listBranches({ org, owner, repo });
        return list.names.map((name) => ({ name }));
      } catch {
        return [];
      }
    },
    [org, stigmer],
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
