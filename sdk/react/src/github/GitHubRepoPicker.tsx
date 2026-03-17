"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useGitHubRepos, type GitHubBranch } from "./useGitHubRepos";

export interface GitHubRepoPickerProps {
  /** GitHub access token for API calls. */
  readonly token: string;
  /** Called when the user selects a repo and branch. */
  readonly onSelect: (repoUrl: string, branch: string) => void;
  readonly className?: string;
}

/**
 * Styled component for browsing and selecting a GitHub repository.
 *
 * Shows a search input, scrollable repo list, and branch selector.
 * All visual properties flow through `--stgm-*` tokens.
 */
export function GitHubRepoPicker({
  token,
  onSelect,
  className,
}: GitHubRepoPickerProps) {
  const { repos, isLoading, error, search, setSearch, hasMore, loadMore, fetchBranches } =
    useGitHubRepos(token);

  const [selectedRepo, setSelectedRepo] = useState<{
    owner: string;
    name: string;
    cloneUrl: string;
    defaultBranch: string;
  } | null>(null);
  const [branches, setBranches] = useState<GitHubBranch[]>([]);
  const [selectedBranch, setSelectedBranch] = useState("");
  const [loadingBranches, setLoadingBranches] = useState(false);

  const listRef = useRef<HTMLDivElement>(null);

  const handleRepoClick = useCallback(
    async (repo: { owner: string; name: string; cloneUrl: string; defaultBranch: string }) => {
      setSelectedRepo(repo);
      setSelectedBranch(repo.defaultBranch);
      setLoadingBranches(true);
      const b = await fetchBranches(repo.owner, repo.name);
      setBranches(b);
      setLoadingBranches(false);
    },
    [fetchBranches],
  );

  const handleAdd = useCallback(() => {
    if (selectedRepo && selectedBranch) {
      onSelect(selectedRepo.cloneUrl, selectedBranch);
      setSelectedRepo(null);
      setBranches([]);
      setSelectedBranch("");
    }
  }, [selectedRepo, selectedBranch, onSelect]);

  const handleScroll = useCallback(() => {
    const el = listRef.current;
    if (!el || isLoading || !hasMore) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 20) {
      loadMore();
    }
  }, [isLoading, hasMore, loadMore]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.addEventListener("scroll", handleScroll);
    return () => el.removeEventListener("scroll", handleScroll);
  }, [handleScroll]);

  if (selectedRepo) {
    return (
      <div className={["space-y-2", className].filter(Boolean).join(" ")}>
        <div className="flex items-center gap-2 text-xs text-foreground">
          <button
            type="button"
            onClick={() => {
              setSelectedRepo(null);
              setBranches([]);
            }}
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Back to repo list"
          >
            <ChevronLeftIcon />
          </button>
          <span className="font-medium truncate">
            {selectedRepo.owner}/{selectedRepo.name}
          </span>
        </div>

        <div className="space-y-1.5">
          <label className="text-[0.65rem] text-muted-foreground">
            Branch
          </label>
          {loadingBranches ? (
            <div className="text-xs text-muted-foreground">
              Loading branches...
            </div>
          ) : (
            <select
              value={selectedBranch}
              onChange={(e) => setSelectedBranch(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {branches.map((b) => (
                <option key={b.name} value={b.name}>
                  {b.name}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleAdd}
            disabled={!selectedBranch}
            className="rounded-md bg-primary px-2.5 py-1 text-xs text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40"
          >
            Add
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={["space-y-2", className].filter(Boolean).join(" ")}>
      <input
        type="text"
        placeholder="Search repositories..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        autoFocus
      />

      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}

      <div
        ref={listRef}
        className="max-h-48 overflow-y-auto space-y-0.5"
      >
        {repos.map((repo) => (
          <button
            key={repo.id}
            type="button"
            onClick={() =>
              handleRepoClick({
                owner: repo.owner,
                name: repo.name,
                cloneUrl: repo.cloneUrl,
                defaultBranch: repo.defaultBranch,
              })
            }
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent/50 transition-colors"
          >
            <span className="min-w-0 flex-1 truncate text-foreground">
              {repo.fullName}
            </span>
            <span className="shrink-0 rounded px-1 py-0.5 text-[0.6rem] bg-muted text-muted-foreground">
              {repo.isPrivate ? "private" : "public"}
            </span>
          </button>
        ))}

        {isLoading && (
          <div className="py-2 text-center text-xs text-muted-foreground">
            Loading...
          </div>
        )}

        {!isLoading && repos.length === 0 && (
          <div className="py-4 text-center text-xs text-muted-foreground">
            {search ? "No repos match your search" : "No repositories found"}
          </div>
        )}
      </div>
    </div>
  );
}

function ChevronLeftIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 3L5 7L9 11" />
    </svg>
  );
}
