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
}

/**
 * The workspace surface's multi-root file explorer.
 *
 * Distinct from {@link import("./WorkspaceEntryFiles.js").WorkspaceEntryFiles}
 * (the inspector's bordered, per-entry filter card): this is the bare,
 * VS Code-style explorer — file-type icons, indent guides, single-click preview
 * / double-click pin — with search living in the rail, not per root. Both share
 * the one `useWorkspaceFiles` cache, so they are two presentations of one
 * listing, never divergent data.
 *
 * All visual properties flow through `--stgm-*` tokens (DD-005).
 */
export function ExplorerTree({
  entries,
  lister,
  selectedFile,
  onOpenFile,
  onActivateFile,
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
}: {
  readonly entry: WorkspaceEntry;
  readonly lister: WorkspaceFileLister;
  readonly defaultExpanded: boolean;
  readonly selectedPath: string | undefined;
  readonly onOpenFile: (entryId: string, path: string) => void;
  readonly onActivateFile: (entryId: string, path: string) => void;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const { tree, isLoading, error, truncated, refresh } = useWorkspaceFiles({
    entry: expanded ? entry : null,
    lister,
  });

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        className={cn(
          "flex items-center gap-1.5 px-1.5 py-1 text-left text-[0.7rem] font-semibold uppercase tracking-wide text-foreground transition-colors hover:bg-accent-hover",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        )}
        title={entry.type === "local" ? entry.localPath : entry.gitUrl}
      >
        <span className="text-[10px] text-muted-foreground-subtle">
          {expanded ? "▼" : "▶"}
        </span>
        <span className="truncate">{entry.name}</span>
      </button>

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
