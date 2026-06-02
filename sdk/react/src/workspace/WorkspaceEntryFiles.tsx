"use client";

import { useCallback, useMemo, useState } from "react";
import { cn } from "@stigmer/theme";
import { FileTreeNode, filterFileTree } from "../internal/file-tree";
import { useWorkspaceFiles } from "./useWorkspaceFiles";
import type { WorkspaceEntry } from "./useWorkspaceEntries";
import type { WorkspaceFileLister } from "./WorkspaceFileLister";

export interface WorkspaceEntryFilesProps {
  /** The workspace entry whose files to browse. */
  readonly entry: WorkspaceEntry;
  /** Platform-injected file lister. */
  readonly lister: WorkspaceFileLister;
  /** Whether the file tree panel is currently expanded. */
  readonly isExpanded: boolean;
}

/**
 * Inline expandable file tree for a single workspace entry.
 *
 * When `isExpanded` is `true`, calls the platform-injected lister and
 * renders a scrollable tree using the shared `FileTreeNode` primitive.
 * Renders loading skeletons, error states, empty states, and a
 * search toolbar for filtering the file tree by name.
 *
 * All visual properties flow through `--stgm-*` tokens (DD-005).
 */
export function WorkspaceEntryFiles({
  entry,
  lister,
  isExpanded,
}: WorkspaceEntryFilesProps) {
  const { tree, isLoading, error, refresh } = useWorkspaceFiles({
    entry: isExpanded ? entry : null,
    lister,
  });

  const [selectedPath, setSelectedPath] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");

  const filteredTree = useMemo(
    () => filterFileTree(tree, searchQuery),
    [tree, searchQuery],
  );

  const isFiltering = searchQuery.trim().length > 0;

  const handleRefresh = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      refresh();
    },
    [refresh],
  );

  const handleClearSearch = useCallback(() => {
    setSearchQuery("");
  }, []);

  if (!isExpanded) return null;

  if (isLoading) {
    return (
      <div
        className="mt-1 space-y-1.5 rounded-md border border-border bg-muted-faint px-2 py-2"
        aria-busy="true"
        aria-label={`Loading files for ${entry.name}`}
      >
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-3.5 animate-pulse rounded bg-muted" style={{ width: `${50 + i * 10}%` }} />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="mt-1 rounded-md border border-border bg-muted-faint px-2.5 py-2 text-xs text-destructive">
        Failed to list files: {error.message}
        <button
          type="button"
          onClick={handleRefresh}
          className="ml-2 underline hover:text-destructive transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  if (tree.length === 0) {
    return (
      <div className="mt-1 rounded-md border border-border bg-muted-faint px-2.5 py-2">
        <p className="text-xs text-muted-foreground">
          No files found.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-1 rounded-md border border-border bg-muted-faint overflow-hidden">
      <div className="flex items-center gap-1.5 border-b border-border px-2 py-1">
        <SearchIcon />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search files..."
          className={cn(
            "min-w-0 flex-1 bg-transparent text-xs text-foreground",
            "placeholder:text-muted-foreground",
            "focus-visible:outline-none",
          )}
          aria-label={`Filter files in ${entry.name}`}
        />
        {isFiltering && (
          <button
            type="button"
            onClick={handleClearSearch}
            className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Clear search"
          >
            <ClearIcon />
          </button>
        )}
        <button
          type="button"
          onClick={handleRefresh}
          className={cn(
            "shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground transition-colors",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          )}
          aria-label={`Refresh file listing for ${entry.name}`}
        >
          <RefreshIcon />
        </button>
      </div>
      {filteredTree.length === 0 ? (
        <div className="px-2.5 py-3 text-center text-xs text-muted-foreground">
          No files matching &ldquo;{searchQuery.trim()}&rdquo;
        </div>
      ) : (
        <nav
          className="overflow-y-auto"
          aria-label={`File tree for ${entry.name}`}
        >
          <ul className="py-0.5" role="tree">
            {filteredTree.map((node) => (
              <FileTreeNode
                key={node.path}
                node={node}
                selectedPath={selectedPath}
                onSelect={setSelectedPath}
                depth={0}
                enableDrag
                maxInitialDepth={isFiltering ? Infinity : 0}
              />
            ))}
          </ul>
        </nav>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Icons (SDK independence — no lucide dependency)
// ---------------------------------------------------------------------------

function SearchIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-muted-foreground">
      <circle cx="5.25" cy="5.25" r="3.5" />
      <path d="M7.75 7.75L10.5 10.5" />
    </svg>
  );
}

function ClearIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3L9 9M9 3L3 9" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1.5 6a4.5 4.5 0 017.794-3.073M10.5 6a4.5 4.5 0 01-7.794 3.073" />
      <path d="M9.5 1v2.5H7M2.5 11V8.5H5" />
    </svg>
  );
}
