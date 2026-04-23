"use client";

import {
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
  type KeyboardEvent,
} from "react";
import { useGitHubRepos, type GitHubRepo, type GitHubBranch } from "./useGitHubRepos";
import { useGitHubSearch } from "./useGitHubSearch";

/** Props for {@link GitHubRepoPicker}. */
export interface GitHubRepoPickerProps {
  /** GitHub access token for API calls. */
  readonly token: string;
  /** Called when the user selects a repo and branch. */
  readonly onSelect: (repoUrl: string, branch: string) => void;
  /** Called when the user dismisses the picker (Escape key). */
  readonly onCancel?: () => void;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

type PickerMode = "my-repos" | "all-github";

// ---------------------------------------------------------------------------
// Recent repos (localStorage persistence)
// ---------------------------------------------------------------------------

interface RecentRepo {
  readonly owner: string;
  readonly name: string;
  readonly cloneUrl: string;
  readonly defaultBranch: string;
}

const RECENT_REPOS_KEY = "stigmer:github:recent-repos";
const MAX_RECENT = 3;

function getRecentRepos(): RecentRepo[] {
  try {
    const stored = localStorage.getItem(RECENT_REPOS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function addRecentRepo(repo: RecentRepo): void {
  const current = getRecentRepos().filter(
    (r) => !(r.owner === repo.owner && r.name === repo.name),
  );
  const updated = [repo, ...current].slice(0, MAX_RECENT);
  localStorage.setItem(RECENT_REPOS_KEY, JSON.stringify(updated));
}

// ---------------------------------------------------------------------------
// Repo grouping (used in "my-repos" mode)
// ---------------------------------------------------------------------------

interface RepoGroup {
  readonly key: string;
  readonly label: string;
  readonly isRecent: boolean;
  readonly repos: GitHubRepo[];
}

function groupRepos(
  filteredRepos: readonly GitHubRepo[],
  recentEntries: readonly RecentRepo[],
): RepoGroup[] {
  const groups: RepoGroup[] = [];
  const repoLookup = new Map(
    filteredRepos.map((r) => [`${r.owner}/${r.name}`, r]),
  );

  const recentMatched = recentEntries
    .map((r) => repoLookup.get(`${r.owner}/${r.name}`))
    .filter((r): r is GitHubRepo => r !== undefined);

  if (recentMatched.length > 0) {
    groups.push({
      key: "recent",
      label: "Recent",
      isRecent: true,
      repos: recentMatched,
    });
  }

  const ownerMap = new Map<
    string,
    { ownerType: "User" | "Organization"; repos: GitHubRepo[] }
  >();
  for (const repo of filteredRepos) {
    const existing = ownerMap.get(repo.owner);
    if (existing) {
      existing.repos.push(repo);
    } else {
      ownerMap.set(repo.owner, { ownerType: repo.ownerType, repos: [repo] });
    }
  }

  const sortedOwners = [...ownerMap.entries()].sort(([, a], [, b]) => {
    if (a.ownerType !== b.ownerType)
      return a.ownerType === "User" ? -1 : 1;
    return b.repos.length - a.repos.length;
  });

  for (const [owner, { repos }] of sortedOwners) {
    groups.push({ key: owner, label: owner, isRecent: false, repos });
  }

  return groups;
}

// ---------------------------------------------------------------------------
// Search highlighting
// ---------------------------------------------------------------------------

function HighlightMatch({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <span className="text-foreground font-medium">
        {text.slice(idx, idx + query.length)}
      </span>
      {text.slice(idx + query.length)}
    </>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const LIST_ID = "stgm-repo-list";
const GITHUB_INSTALLATIONS_URL = "https://github.com/settings/installations";

/**
 * Styled component for browsing and selecting a GitHub repository.
 *
 * Features:
 * - Two modes: "My Repos" (user's own repos) and "All GitHub" (public search)
 * - Owner-grouped sections in My Repos mode
 * - Recently selected repos pinned at top
 * - Fixed max-height with scroll shadow indicators
 * - Keyboard navigation (Arrow keys, Enter, Escape)
 * - Search with match highlighting
 * - Branch selector after repo selection
 * - Manual URL entry for repos not discoverable via search
 * - Link to manage GitHub App repository access
 *
 * All visual properties flow through `--stgm-*` tokens.
 *
 * @example
 * ```tsx
 * function RepoSelector({ token }: { token: string }) {
 *   return (
 *     <GitHubRepoPicker
 *       token={token}
 *       onSelect={(url, branch) => workspace.addGitRepo(url, branch)}
 *       onCancel={() => setShowPicker(false)}
 *     />
 *   );
 * }
 * ```
 */
export function GitHubRepoPicker({
  token,
  onSelect,
  onCancel,
  className,
}: GitHubRepoPickerProps) {
  const [mode, setMode] = useState<PickerMode>("my-repos");
  const [showManualEntry, setShowManualEntry] = useState(false);

  // My Repos data
  const myRepos = useGitHubRepos(token);

  // All GitHub search data
  const githubSearch = useGitHubSearch(token);

  // Branch selection state (shared across modes)
  const [selectedRepo, setSelectedRepo] = useState<{
    owner: string;
    name: string;
    cloneUrl: string;
    defaultBranch: string;
  } | null>(null);
  const [branches, setBranches] = useState<GitHubBranch[]>([]);
  const [selectedBranch, setSelectedBranch] = useState("");
  const [loadingBranches, setLoadingBranches] = useState(false);

  // Manual URL state
  const [manualUrl, setManualUrl] = useState("");
  const [manualBranch, setManualBranch] = useState("");

  // Keyboard navigation
  const [focusIndex, setFocusIndex] = useState(-1);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Scroll shadow state
  const [canScrollUp, setCanScrollUp] = useState(false);
  const [canScrollDown, setCanScrollDown] = useState(false);

  // Recent repos
  const [recentRepos, setRecentRepos] = useState<RecentRepo[]>(getRecentRepos);

  // --- Mode-dependent derived state ---

  const activeSearch = mode === "my-repos" ? myRepos.search : githubSearch.query;
  const setActiveSearch = mode === "my-repos" ? myRepos.setSearch : githubSearch.setQuery;
  const activeRepos = mode === "my-repos" ? myRepos.repos : githubSearch.results;
  const activeError = mode === "my-repos" ? myRepos.error : githubSearch.error;
  const activeIsLoading = mode === "my-repos" ? myRepos.isLoading : githubSearch.isSearching;

  // Group repos only in "my-repos" mode
  const groups = useMemo(
    () => (mode === "my-repos" ? groupRepos(activeRepos, recentRepos) : []),
    [mode, activeRepos, recentRepos],
  );

  // Flat list for keyboard nav: grouped in my-repos, flat in all-github
  const flatItems = useMemo(() => {
    if (mode === "all-github") return [...activeRepos];
    const items: GitHubRepo[] = [];
    for (const group of groups) {
      for (const repo of group.repos) {
        items.push(repo);
      }
    }
    return items;
  }, [mode, activeRepos, groups]);

  // Reset focus index when search or mode changes
  useEffect(() => {
    setFocusIndex(-1);
  }, [activeSearch, mode]);

  // Scroll focused item into view
  useEffect(() => {
    if (focusIndex >= 0) {
      const el = listRef.current?.querySelector(
        `[data-idx="${focusIndex}"]`,
      );
      el?.scrollIntoView({ block: "nearest" });
    }
  }, [focusIndex]);

  // Scroll shadow tracking
  const updateScrollShadows = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    setCanScrollUp(el.scrollTop > 0);
    setCanScrollDown(
      el.scrollTop + el.clientHeight < el.scrollHeight - 1,
    );
  }, []);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.addEventListener("scroll", updateScrollShadows, { passive: true });
    updateScrollShadows();
    return () => el.removeEventListener("scroll", updateScrollShadows);
  }, [updateScrollShadows]);

  useEffect(() => {
    updateScrollShadows();
  }, [activeRepos, updateScrollShadows]);

  const handleModeSwitch = useCallback(
    (newMode: PickerMode) => {
      if (newMode === mode) return;
      setMode(newMode);
      setFocusIndex(-1);
      if (newMode === "my-repos") {
        githubSearch.setQuery("");
      } else {
        myRepos.setSearch("");
      }
      setTimeout(() => searchRef.current?.focus(), 0);
    },
    [mode, githubSearch, myRepos],
  );

  const handleRepoClick = useCallback(
    async (repo: GitHubRepo) => {
      setSelectedRepo({
        owner: repo.owner,
        name: repo.name,
        cloneUrl: repo.cloneUrl,
        defaultBranch: repo.defaultBranch,
      });
      setSelectedBranch(repo.defaultBranch);
      setLoadingBranches(true);
      const b = await myRepos.fetchBranches(repo.owner, repo.name);
      setBranches(b);
      setLoadingBranches(false);
    },
    [myRepos],
  );

  const handleAdd = useCallback(() => {
    if (selectedRepo && selectedBranch) {
      addRecentRepo({
        owner: selectedRepo.owner,
        name: selectedRepo.name,
        cloneUrl: selectedRepo.cloneUrl,
        defaultBranch: selectedRepo.defaultBranch,
      });
      setRecentRepos(getRecentRepos());
      onSelect(selectedRepo.cloneUrl, selectedBranch);
      setSelectedRepo(null);
      setBranches([]);
      setSelectedBranch("");
    }
  }, [selectedRepo, selectedBranch, onSelect]);

  const handleManualAdd = useCallback(() => {
    const url = manualUrl.trim();
    if (!url) return;
    onSelect(url, manualBranch.trim() || "main");
    setManualUrl("");
    setManualBranch("");
    setShowManualEntry(false);
  }, [manualUrl, manualBranch, onSelect]);

  const handleSearchKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusIndex((prev) =>
          prev < flatItems.length - 1 ? prev + 1 : prev,
        );
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusIndex((prev) => (prev > 0 ? prev - 1 : -1));
      } else if (
        e.key === "Enter" &&
        focusIndex >= 0 &&
        focusIndex < flatItems.length
      ) {
        e.preventDefault();
        handleRepoClick(flatItems[focusIndex]);
      } else if (e.key === "Enter") {
        e.preventDefault();
      } else if (e.key === "Escape") {
        e.preventDefault();
        if (activeSearch) {
          setActiveSearch("");
          setFocusIndex(-1);
        } else {
          onCancel?.();
        }
      }
    },
    [flatItems, focusIndex, handleRepoClick, onCancel, activeSearch, setActiveSearch],
  );

  const handleManualKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleManualAdd();
      } else if (e.key === "Escape") {
        e.preventDefault();
        setShowManualEntry(false);
        setTimeout(() => searchRef.current?.focus(), 0);
      }
    },
    [handleManualAdd],
  );

  // --- Branch selection view ---
  if (selectedRepo) {
    return (
      <div className={["space-y-2", className].filter(Boolean).join(" ")}>
        <div className="flex items-center gap-2 text-xs text-foreground">
          <button
            type="button"
            onClick={() => {
              setSelectedRepo(null);
              setBranches([]);
              setTimeout(() => searchRef.current?.focus(), 0);
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
            className="rounded-md bg-primary px-2.5 py-1 text-xs text-primary-foreground hover:bg-primary-hover transition-colors disabled:opacity-40"
          >
            Add
          </button>
        </div>
      </div>
    );
  }

  // --- Manual URL entry view ---
  if (showManualEntry) {
    return (
      <div className={["space-y-2", className].filter(Boolean).join(" ")}>
        <div className="flex items-center gap-2 text-xs text-foreground">
          <button
            type="button"
            onClick={() => {
              setShowManualEntry(false);
              setTimeout(() => searchRef.current?.focus(), 0);
            }}
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Back to repo list"
          >
            <ChevronLeftIcon />
          </button>
          <span className="font-medium">Paste a repository URL</span>
        </div>

        <input
          type="url"
          placeholder="https://github.com/org/repo"
          value={manualUrl}
          onChange={(e) => setManualUrl(e.target.value)}
          onKeyDown={handleManualKeyDown}
          className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          autoFocus
        />
        <input
          type="text"
          placeholder="Branch (optional, defaults to main)"
          value={manualBranch}
          onChange={(e) => setManualBranch(e.target.value)}
          onKeyDown={handleManualKeyDown}
          className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />

        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleManualAdd}
            disabled={!manualUrl.trim()}
            className="rounded-md bg-primary px-2.5 py-1 text-xs text-primary-foreground hover:bg-primary-hover transition-colors disabled:opacity-40"
          >
            Add
          </button>
        </div>
      </div>
    );
  }

  // --- Compute flat index offsets per group for "my-repos" rendering ---
  let runningIndex = 0;
  const groupOffsets = groups.map((g) => {
    const offset = runningIndex;
    runningIndex += g.repos.length;
    return offset;
  });

  // --- Main repo list view ---
  return (
    <div
      className={["space-y-1.5", className].filter(Boolean).join(" ")}
    >
      {/* Mode toggle */}
      <div className="flex rounded-md border border-border bg-muted-faint p-0.5">
        <button
          type="button"
          onClick={() => handleModeSwitch("my-repos")}
          className={[
            "flex-1 rounded px-2 py-1 text-[0.65rem] font-medium transition-colors",
            mode === "my-repos"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          ].join(" ")}
        >
          My Repos
        </button>
        <button
          type="button"
          onClick={() => handleModeSwitch("all-github")}
          className={[
            "flex-1 rounded px-2 py-1 text-[0.65rem] font-medium transition-colors",
            mode === "all-github"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          ].join(" ")}
        >
          All GitHub
        </button>
      </div>

      {/* Search input */}
      <input
        ref={searchRef}
        type="text"
        role="combobox"
        aria-expanded={true}
        aria-controls={LIST_ID}
        aria-activedescendant={
          focusIndex >= 0 ? `stgm-repo-${focusIndex}` : undefined
        }
        placeholder={
          mode === "my-repos"
            ? "Search repositories..."
            : "Search all of GitHub..."
        }
        value={activeSearch}
        onChange={(e) => setActiveSearch(e.target.value)}
        onKeyDown={handleSearchKeyDown}
        className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        autoFocus
      />

      {activeError && (
        <p className="text-xs text-destructive">
          {activeError}
        </p>
      )}

      {/* Scrollable repo list with scroll shadows */}
      <div className="relative">
        {canScrollUp && (
          <div
            className="absolute inset-x-0 top-0 h-3 z-10 pointer-events-none"
            style={{
              background:
                "linear-gradient(to bottom, var(--color-card, hsl(0 0% 9%)), transparent)",
            }}
          />
        )}

        <div
          ref={listRef}
          id={LIST_ID}
          role="listbox"
          aria-label="Repositories"
          className="max-h-64 overflow-y-auto"
        >
          {mode === "my-repos" ? (
            <MyReposList
              groups={groups}
              groupOffsets={groupOffsets}
              flatItems={flatItems}
              focusIndex={focusIndex}
              isLoading={myRepos.isLoading}
              isBackgroundLoading={myRepos.isBackgroundLoading}
              search={myRepos.search}
              onRepoClick={handleRepoClick}
            />
          ) : (
            <SearchResultsList
              results={githubSearch.results}
              focusIndex={focusIndex}
              isSearching={githubSearch.isSearching}
              query={githubSearch.query}
              totalCount={githubSearch.totalCount}
              hasMore={githubSearch.hasMore}
              onRepoClick={handleRepoClick}
              onLoadMore={githubSearch.loadMore}
            />
          )}
        </div>

        {canScrollDown && (
          <div
            className="absolute inset-x-0 bottom-0 h-3 z-10 pointer-events-none"
            style={{
              background:
                "linear-gradient(to top, var(--color-card, hsl(0 0% 9%)), transparent)",
            }}
          />
        )}
      </div>

      {/* Footer: manual URL + manage access */}
      <div className="flex items-center gap-3 border-t border-border pt-1.5 text-[0.65rem] text-muted-foreground">
        <button
          type="button"
          onClick={() => setShowManualEntry(true)}
          className="hover:text-foreground transition-colors"
        >
          Paste a URL
        </button>
        <span className="opacity-30">·</span>
        <a
          href={GITHUB_INSTALLATIONS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-foreground transition-colors"
        >
          Manage access
        </a>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// My Repos list (grouped)
// ---------------------------------------------------------------------------

function MyReposList({
  groups,
  groupOffsets,
  flatItems,
  focusIndex,
  isLoading,
  isBackgroundLoading,
  search,
  onRepoClick,
}: {
  groups: RepoGroup[];
  groupOffsets: number[];
  flatItems: GitHubRepo[];
  focusIndex: number;
  isLoading: boolean;
  isBackgroundLoading: boolean;
  search: string;
  onRepoClick: (repo: GitHubRepo) => void;
}) {
  if (isLoading) return <LoadingSkeleton />;

  if (flatItems.length === 0) {
    return (
      <div className="py-4 text-center text-xs text-muted-foreground">
        {search ? "No repos match your search" : "No repositories found"}
      </div>
    );
  }

  return (
    <>
      {groups.map((group, gi) => (
        <div key={group.key}>
          <div className="sticky top-0 z-[1] bg-card px-2 py-1 text-[0.65rem] font-medium text-muted-foreground backdrop-blur-sm">
            {group.label}
            {!group.isRecent && (
              <span className="ml-1 opacity-50">
                ({group.repos.length})
              </span>
            )}
          </div>

          {group.repos.map((repo, ri) => {
            const flatIdx = groupOffsets[gi] + ri;
            return (
              <RepoRow
                key={`${group.key}-${repo.id}`}
                repo={repo}
                flatIdx={flatIdx}
                focusIndex={focusIndex}
                displayName={group.isRecent ? repo.fullName : repo.name}
                query={search}
                onClick={onRepoClick}
              />
            );
          })}
        </div>
      ))}

      {isBackgroundLoading && (
        <div className="py-1 text-center text-[0.6rem] text-muted-foreground">
          Loading more...
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// All GitHub search results list (flat)
// ---------------------------------------------------------------------------

function SearchResultsList({
  results,
  focusIndex,
  isSearching,
  query,
  totalCount,
  hasMore,
  onRepoClick,
  onLoadMore,
}: {
  results: readonly GitHubRepo[];
  focusIndex: number;
  isSearching: boolean;
  query: string;
  totalCount: number;
  hasMore: boolean;
  onRepoClick: (repo: GitHubRepo) => void;
  onLoadMore: () => void;
}) {
  if (!query) {
    return (
      <div className="py-6 text-center text-xs text-muted-foreground">
        Type to search all of GitHub
      </div>
    );
  }

  if (isSearching && results.length === 0) {
    return <LoadingSkeleton />;
  }

  if (results.length === 0) {
    return (
      <div className="py-4 text-center text-xs text-muted-foreground">
        No repositories found
      </div>
    );
  }

  return (
    <>
      {totalCount > 0 && (
        <div className="px-2 py-1 text-[0.6rem] text-muted-foreground">
          {totalCount.toLocaleString()} {totalCount === 1 ? "result" : "results"}
        </div>
      )}

      {results.map((repo, i) => (
        <RepoRow
          key={repo.id}
          repo={repo}
          flatIdx={i}
          focusIndex={focusIndex}
          displayName={repo.fullName}
          query={query}
          onClick={onRepoClick}
        />
      ))}

      {isSearching && (
        <div className="py-1 text-center text-[0.6rem] text-muted-foreground">
          Searching...
        </div>
      )}

      {hasMore && !isSearching && (
        <button
          type="button"
          onClick={onLoadMore}
          className="w-full py-1.5 text-center text-[0.65rem] text-muted-foreground hover:text-foreground transition-colors"
        >
          Load more results
        </button>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Shared repo row
// ---------------------------------------------------------------------------

function RepoRow({
  repo,
  flatIdx,
  focusIndex,
  displayName,
  query,
  onClick,
}: {
  repo: GitHubRepo;
  flatIdx: number;
  focusIndex: number;
  displayName: string;
  query: string;
  onClick: (repo: GitHubRepo) => void;
}) {
  return (
    <button
      id={`stgm-repo-${flatIdx}`}
      type="button"
      data-idx={flatIdx}
      onClick={() => onClick(repo)}
      className={[
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
        flatIdx === focusIndex
          ? "bg-accent text-foreground"
          : "text-foreground hover:bg-accent-hover",
      ].join(" ")}
      role="option"
      aria-selected={flatIdx === focusIndex}
    >
      <span className="min-w-0 flex-1 truncate">
        <HighlightMatch text={displayName} query={query} />
      </span>
      <span className="shrink-0 rounded px-1 py-0.5 text-[0.6rem] bg-muted text-muted-foreground">
        {repo.isPrivate ? "private" : "public"}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function LoadingSkeleton() {
  return (
    <div className="space-y-1 py-1">
      <div className="px-2 py-1">
        <div className="h-2.5 w-16 rounded bg-muted animate-pulse" />
      </div>
      {[55, 70, 40, 62].map((w, i) => (
        <div key={i} className="flex items-center gap-2 px-2 py-1.5">
          <div
            className="h-3 rounded bg-muted animate-pulse"
            style={{ width: `${w}%` }}
          />
        </div>
      ))}
      <div className="px-2 py-1">
        <div className="h-2.5 w-20 rounded bg-muted animate-pulse" />
      </div>
      {[48, 65, 53].map((w, i) => (
        <div key={i + 4} className="flex items-center gap-2 px-2 py-1.5">
          <div
            className="h-3 rounded bg-muted animate-pulse"
            style={{ width: `${w}%` }}
          />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

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
