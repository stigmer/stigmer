"use client";

import { useCallback, useState } from "react";
import { cn } from "@stigmer/theme";
import { FileTreeNode } from "../internal/file-tree";
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
 * Renders loading skeletons, error states, empty states, and the
 * GitHub API truncation indicator.
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

  const handleRefresh = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      refresh();
    },
    [refresh],
  );

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
      <div className="flex items-center justify-between border-b border-border px-2.5 py-1">
        <span className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">
          Files
        </span>
        <button
          type="button"
          onClick={handleRefresh}
          className={cn(
            "text-[0.6rem] text-muted-foreground hover:text-foreground transition-colors",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded px-1",
          )}
          aria-label={`Refresh file listing for ${entry.name}`}
        >
          Refresh
        </button>
      </div>
      <nav
        className="max-h-[240px] overflow-y-auto"
        aria-label={`File tree for ${entry.name}`}
      >
        <ul className="py-0.5" role="tree">
          {tree.map((node) => (
            <FileTreeNode
              key={node.path}
              node={node}
              selectedPath={selectedPath}
              onSelect={setSelectedPath}
              depth={0}
              enableDrag
              maxInitialDepth={2}
            />
          ))}
        </ul>
      </nav>
    </div>
  );
}
