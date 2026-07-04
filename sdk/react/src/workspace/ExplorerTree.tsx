"use client";

import { useState } from "react";
import { cn } from "@stigmer/theme";
import { FileTreeNode } from "../internal/file-tree/index.js";
import type { SelectedWorkspaceFile } from "../internal/store/index.js";
import { useWorkspaceFiles } from "./useWorkspaceFiles.js";
import type { WorkspaceEntry } from "./useWorkspaceEntries.js";
import type { WorkspaceFileLister } from "./WorkspaceFileLister.js";

/** Props for {@link ExplorerTree}. */
export interface ExplorerTreeProps {
  /** Workspace entries, each rendered as a collapsible root (multi-root). */
  readonly entries: readonly WorkspaceEntry[];
  /** Platform-injected file lister. */
  readonly lister: WorkspaceFileLister;
  /** The active file, highlighted in the tree. */
  readonly selectedFile: SelectedWorkspaceFile | null;
  /** Single click: open as a preview tab. */
  readonly onOpenFile: (entryId: string, path: string) => void;
  /** Double click: pin the file (persistent tab). */
  readonly onActivateFile: (entryId: string, path: string) => void;
  /**
   * Detach a workspace entry. When provided, each root header carries a remove
   * control (VS Code's "Remove Folder from Workspace"); when absent the
   * explorer is browse-only.
   */
  readonly onRemoveEntry?: (entryId: string) => void;
}

/**
 * The workspace surface's multi-root file explorer — the bare, VS Code-style
 * tree: file-type icons, indent guides, single-click preview / double-click
 * pin, optional per-root remove controls. Search lives in the surface's rail,
 * not per root; listings come from the shared `useWorkspaceFiles` cache.
 *
 * All visual properties flow through `--stgm-*` tokens (DD-005).
 */
export function ExplorerTree({
  entries,
  lister,
  selectedFile,
  onOpenFile,
  onActivateFile,
  onRemoveEntry,
}: ExplorerTreeProps) {
  return (
    <div className="flex flex-col">
      {entries.map((entry, index) => (
        <ExplorerRoot
          key={entry.id}
          entry={entry}
          lister={lister}
          defaultExpanded={index === 0}
          selectedPath={
            selectedFile?.entryId === entry.id ? selectedFile.path : undefined
          }
          onOpenFile={onOpenFile}
          onActivateFile={onActivateFile}
          onRemove={onRemoveEntry}
        />
      ))}
    </div>
  );
}

/** One workspace root: a collapsible header over its file tree. */
function ExplorerRoot({
  entry,
  lister,
  defaultExpanded,
  selectedPath,
  onOpenFile,
  onActivateFile,
  onRemove,
}: {
  readonly entry: WorkspaceEntry;
  readonly lister: WorkspaceFileLister;
  readonly defaultExpanded: boolean;
  readonly selectedPath: string | undefined;
  readonly onOpenFile: (entryId: string, path: string) => void;
  readonly onActivateFile: (entryId: string, path: string) => void;
  readonly onRemove?: (entryId: string) => void;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const { tree, isLoading, error, truncated, refresh } = useWorkspaceFiles({
    entry: expanded ? entry : null,
    lister,
  });

  return (
    <div className="flex flex-col">
      <div className="group/root flex items-stretch">
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          aria-expanded={expanded}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-1.5 px-1.5 py-1 text-left text-[0.7rem] font-semibold uppercase tracking-wide text-foreground transition-colors hover:bg-accent-hover",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          )}
          title={entry.type === "local" ? entry.localPath : entry.gitUrl}
        >
          <span className="text-[10px] text-muted-foreground-subtle">
            {expanded ? "▼" : "▶"}
          </span>
          <span className="truncate">{entry.name}</span>
        </button>
        {onRemove && (
          <button
            type="button"
            onClick={() => onRemove(entry.id)}
            aria-label={`Remove ${entry.name} from workspace`}
            title={`Remove ${entry.name} from workspace`}
            className={cn(
              "shrink-0 px-1.5 text-muted-foreground opacity-0 transition-opacity",
              "group-hover/root:opacity-100 focus-visible:opacity-100",
              "hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
            )}
          >
            <RemoveIcon />
          </button>
        )}
      </div>

      {expanded && (
        <ExplorerRootBody
          entryName={entry.name}
          entryId={entry.id}
          tree={tree}
          isLoading={isLoading}
          error={error}
          truncated={truncated}
          selectedPath={selectedPath}
          onOpenFile={onOpenFile}
          onActivateFile={onActivateFile}
          onRetry={refresh}
        />
      )}
    </div>
  );
}

function ExplorerRootBody({
  entryName,
  entryId,
  tree,
  isLoading,
  error,
  truncated,
  selectedPath,
  onOpenFile,
  onActivateFile,
  onRetry,
}: {
  readonly entryName: string;
  readonly entryId: string;
  readonly tree: ReturnType<typeof useWorkspaceFiles>["tree"];
  readonly isLoading: boolean;
  readonly error: Error | null;
  readonly truncated: boolean;
  readonly selectedPath: string | undefined;
  readonly onOpenFile: (entryId: string, path: string) => void;
  readonly onActivateFile: (entryId: string, path: string) => void;
  readonly onRetry: () => void;
}) {
  if (isLoading) {
    return (
      <div
        className="space-y-1.5 px-2 py-2"
        aria-busy="true"
        aria-label={`Loading files for ${entryName}`}
      >
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-3.5 animate-pulse rounded bg-muted"
            style={{ width: `${50 + i * 10}%` }}
            aria-hidden="true"
          />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-2 py-2 text-xs text-destructive">
        Failed to list files: {error.message}
        <button
          type="button"
          onClick={onRetry}
          className="ml-2 underline transition-colors hover:text-destructive"
        >
          Retry
        </button>
      </div>
    );
  }

  if (tree.length === 0) {
    return (
      <p className="px-3 py-2 text-xs text-muted-foreground">No files found.</p>
    );
  }

  return (
    <>
      <nav aria-label={`File tree for ${entryName}`}>
        <ul className="py-0.5 pl-1.5" role="tree">
          {tree.map((node) => (
            <FileTreeNode
              key={node.path}
              node={node}
              selectedPath={selectedPath ?? ""}
              onSelect={(path) => onOpenFile(entryId, path)}
              onActivate={(path) => onActivateFile(entryId, path)}
              depth={0}
              enableDrag
              showIcons
              indentGuides
              maxInitialDepth={0}
            />
          ))}
        </ul>
      </nav>
      {truncated && (
        <p className="px-3 py-1.5 text-[0.65rem] text-muted-foreground">
          Showing a partial listing — this repository has too many files to load
          in full.
        </p>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Inline SVG icons (SDK independence — no lucide dependency)
// ---------------------------------------------------------------------------

function RemoveIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 4L10 10M10 4L4 10" />
    </svg>
  );
}
