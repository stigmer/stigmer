"use client";

import { useCallback, useState, type KeyboardEvent } from "react";
import { cn } from "@stigmer/theme";
import type { UseWorkspaceEntriesReturn, WorkspaceEntry } from "../../workspace/useWorkspaceEntries.js";
import type { WorkspaceFileLister } from "../../workspace/WorkspaceFileLister.js";
import type { WorkspaceFileReader } from "../../workspace/WorkspaceFileReader.js";
import { WorkspaceEntryFiles } from "../../workspace/WorkspaceEntryFiles.js";
import { WorkspaceFileSearch } from "../../workspace/WorkspaceFileSearch.js";
import type { UseGitHubConnectionReturn } from "../../github/useGitHubConnection.js";
import type { SelectedWorkspaceFile } from "../../internal/store/workspace-file-selection-store.js";

/** Which face of the Workspace tab is showing: the file tree or search. */
type WorkspaceViewMode = "files" | "search";

/**
 * Interactive workspace actions required by the Workspace tab.
 * Mirrors the shape from SetupTab for consistency but is the
 * primary owner going forward.
 */
export interface WorkspaceTabActions {
  readonly workspace: UseWorkspaceEntriesReturn;
  readonly enableGitHub?: boolean;
  readonly enableLocal?: boolean;
  readonly gitHubConnection?: UseGitHubConnectionReturn;
  readonly onBrowseLocalFolder?: () => Promise<string | null>;
  readonly workspaceFileLister?: WorkspaceFileLister;
  /**
   * Content reader for the viewer. Not consumed here — carried on the same
   * actions channel as the lister so the inspector can hand it to
   * {@link FileViewer} in the Viewer tab.
   */
  readonly workspaceFileReader?: WorkspaceFileReader;
  /**
   * Opens a file in the viewer. When present, file-tree rows become
   * open-in-viewer triggers; when absent, the tree keeps its drag-only
   * behavior (backward compatible).
   */
  readonly onOpenFile?: (entryId: string, path: string) => void;
}

/** Props for {@link WorkspaceTab}. */
export interface WorkspaceTabProps {
  readonly actions: WorkspaceTabActions;
  /** The file currently open in the viewer, used to highlight it in the tree. */
  readonly selectedFile?: SelectedWorkspaceFile | null;
}

/**
 * Dedicated workspace tab for the SessionInspector.
 *
 * Provides a full-height layout for managing workspace entries:
 * - Entry list with expandable file trees (accordion, one at a time)
 * - Add actions: Browse Folder and Connect GitHub
 * - Short display names with full path on hover
 *
 * Entries start collapsed by default to avoid expensive file-listing
 * fetches until the user explicitly expands one.
 *
 * All visual properties flow through `--stgm-*` tokens (DD-005).
 */
export function WorkspaceTab({ actions, selectedFile }: WorkspaceTabProps) {
  const {
    workspace,
    enableGitHub = true,
    enableLocal = false,
    onBrowseLocalFolder,
    workspaceFileLister,
    onOpenFile,
  } = actions;

  const [viewMode, setViewMode] = useState<WorkspaceViewMode>("files");

  const canBrowse = enableLocal && onBrowseLocalFolder;
  const hasEntries = workspace.entries.length > 0;

  // Search is offered only when there is something to search (a lister and at
  // least one entry) and a viewer sink to open a hit into (DD-10). Without a
  // viewer sink the tree is drag-only, so search would have nowhere to route.
  const canSearch = !!workspaceFileLister && hasEntries && !!onOpenFile;
  const effectiveMode: WorkspaceViewMode = canSearch ? viewMode : "files";

  if (effectiveMode === "search" && workspaceFileLister && onOpenFile) {
    return (
      <div className="flex h-full flex-col gap-2">
        <WorkspaceViewToggle value="search" onChange={setViewMode} />
        <WorkspaceFileSearch
          entries={workspace.entries}
          lister={workspaceFileLister}
          onOpenFile={onOpenFile}
          selectedFile={selectedFile ?? null}
          className="min-h-0 flex-1"
        />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3">
      {canSearch && <WorkspaceViewToggle value="files" onChange={setViewMode} />}

      {hasEntries && (
        <WorkspaceEntryList
          entries={workspace.entries}
          onRemove={workspace.remove}
          lister={workspaceFileLister}
          onOpenFile={onOpenFile}
          selectedFile={selectedFile ?? null}
        />
      )}

      {!hasEntries && (
        <EmptyState />
      )}

      <div className="flex flex-col gap-0.5">
        {canBrowse && (
          <button
            type="button"
            onClick={async () => {
              const path = await onBrowseLocalFolder();
              if (path) workspace.addLocalPath(path);
            }}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-xs text-foreground transition-colors hover:bg-accent-hover"
          >
            <FolderPlusIcon />
            <span className="flex-1 text-left">Browse Folder</span>
          </button>
        )}
        {enableGitHub && (
          <button
            type="button"
            onClick={() => {
              /* GitHub picker is handled via the composer's Configure menu.
                 This button is a placeholder affordance for visual parity. */
            }}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-xs text-foreground transition-colors hover:bg-accent-hover"
          >
            <GitHubIcon />
            <span className="flex-1 text-left">Connect GitHub</span>
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Files | Search mode toggle
// ---------------------------------------------------------------------------

/**
 * Segmented control switching the Workspace tab between the file tree and
 * workspace-wide search. A mutually-exclusive choice, so it follows the
 * platform's `role="radiogroup"` pattern (see `FileViewer`'s `ViewerModeToggle`
 * / `library/ScopeToggle`) rather than a tablist nested in the inspector's tabs.
 */
function WorkspaceViewToggle({
  value,
  onChange,
}: {
  readonly value: WorkspaceViewMode;
  readonly onChange: (next: WorkspaceViewMode) => void;
}) {
  const options: readonly { readonly value: WorkspaceViewMode; readonly label: string }[] = [
    { value: "files", label: "Files" },
    { value: "search", label: "Search" },
  ];

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>) => {
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        onChange("search");
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        onChange("files");
      }
    },
    [onChange],
  );

  return (
    <div
      role="radiogroup"
      aria-label="Workspace view"
      className="inline-flex rounded-md bg-muted p-0.5"
    >
      {options.map((option) => {
        const isSelected = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isSelected}
            tabIndex={isSelected ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={handleKeyDown}
            className={cn(
              "inline-flex cursor-pointer items-center rounded-sm px-2.5 py-0.5 text-xs font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isSelected
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Workspace entry list — accordion with file tree expansion
// ---------------------------------------------------------------------------

function WorkspaceEntryList({
  entries,
  onRemove,
  lister,
  onOpenFile,
  selectedFile,
}: {
  readonly entries: readonly WorkspaceEntry[];
  readonly onRemove: (id: string) => void;
  readonly lister: WorkspaceFileLister | undefined;
  readonly onOpenFile?: (entryId: string, path: string) => void;
  readonly selectedFile: SelectedWorkspaceFile | null;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const toggleExpand = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  }, []);

  return (
    <div className="flex flex-col gap-1.5">
      {entries.map((entry) => {
        const isExpandable = !!lister;
        const isExpanded = expandedId === entry.id;

        return (
          <div key={entry.id} className="flex flex-col">
            <div
              className={cn(
                "flex items-center gap-2 rounded-md border border-border bg-muted-faint px-2.5 py-2 text-xs",
                isExpandable && "cursor-pointer hover:bg-muted transition-colors",
              )}
              onClick={isExpandable ? () => toggleExpand(entry.id) : undefined}
              role={isExpandable ? "button" : undefined}
              aria-expanded={isExpandable ? isExpanded : undefined}
              tabIndex={isExpandable ? 0 : undefined}
              onKeyDown={isExpandable ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  toggleExpand(entry.id);
                }
              } : undefined}
            >
              {isExpandable && (
                <span className="shrink-0 text-[10px] text-muted-foreground-subtle">
                  {isExpanded ? "▼" : "▶"}
                </span>
              )}
              {entry.type === "git" ? (
                <GitHubIcon />
              ) : (
                <FolderIcon />
              )}
              <div className="min-w-0 flex-1">
                <span
                  className="block truncate font-medium text-foreground"
                  title={entry.type === "local" ? entry.localPath : entry.gitUrl}
                >
                  {entry.name}
                </span>
                {entry.type === "git" && entry.gitBranch && (
                  <span className="block truncate text-[0.6rem] text-muted-foreground">
                    {entry.gitBranch}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(entry.id);
                }}
                className="shrink-0 text-muted-foreground hover:text-destructive transition-colors"
                aria-label={`Remove ${entry.name}`}
              >
                <XIcon />
              </button>
            </div>
            {isExpandable && lister && (
              <WorkspaceEntryFiles
                entry={entry}
                lister={lister}
                isExpanded={isExpanded}
                onOpenFile={onOpenFile}
                selectedPath={
                  selectedFile?.entryId === entry.id ? selectedFile.path : undefined
                }
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
      <FolderIcon className="h-8 w-8 text-muted-foreground-subtle" />
      <div className="space-y-1">
        <p className="text-xs font-medium text-foreground">No workspace attached</p>
        <p className="text-[0.65rem] text-muted-foreground">
          Add a folder or GitHub repo for the agent to work with.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline SVG icons (SDK independence — no lucide dependency)
// ---------------------------------------------------------------------------

function XIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4L10 10M10 4L4 10" />
    </svg>
  );
}

function FolderIcon({ className: cls }: { className?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={cn("shrink-0 text-muted-foreground", cls)}>
      <path d="M1.5 3.5V11a1 1 0 001 1h9a1 1 0 001-1V5.5a1 1 0 00-1-1H7L5.5 3H2.5a1 1 0 00-1 .5z" />
    </svg>
  );
}

function FolderPlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-muted-foreground">
      <path d="M1.5 3.5V11a1 1 0 001 1h9a1 1 0 001-1V5.5a1 1 0 00-1-1H7L5.5 3H2.5a1 1 0 00-1 .5z" />
      <path d="M7 7v3M5.5 8.5h3" />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" className="shrink-0 text-muted-foreground">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}
