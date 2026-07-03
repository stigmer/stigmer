"use client";

import { useCallback, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "@stigmer/theme";
import type { FileChange } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { ResizableSplit } from "../internal/ResizableSplit.js";
import {
  editorKey,
  type OpenEditor,
  type SelectedWorkspaceFile,
} from "../internal/store/index.js";
import type { WorkspaceEntry } from "./useWorkspaceEntries.js";
import type { WorkspaceFileLister } from "./WorkspaceFileLister.js";
import type { WorkspaceFileReader } from "./WorkspaceFileReader.js";
import { WorkspaceFileSearch } from "./WorkspaceFileSearch.js";
import { FileViewer, type FileViewerHandle } from "./FileViewer.js";
import { EditorTabs } from "./EditorTabs.js";
import { ExplorerTree } from "./ExplorerTree.js";

/** Which rail view is active: the file explorer or workspace-wide search. */
type RailView = "files" | "search";

/** Props for {@link WorkspaceSurface}. */
export interface WorkspaceSurfaceProps {
  /** The workspace entries whose files are browsable (multi-root). */
  readonly entries: readonly WorkspaceEntry[];
  /** Platform-injected file lister. `undefined` disables explorer + search. */
  readonly lister: WorkspaceFileLister | undefined;
  /** Platform-injected content reader for the editor. */
  readonly reader: WorkspaceFileReader | undefined;
  /** Open editor tabs in order (VS Code open-editors model). */
  readonly editors: readonly OpenEditor[];
  /** The active editor's file, or `null`. Highlighted in the tree and shown. */
  readonly selectedFile: SelectedWorkspaceFile | null;
  /**
   * Opens a file as a preview (single click) from the explorer or search. The
   * same seam the tree/search uses; the owner routes it to the editors store.
   */
  readonly onOpenFile: (entryId: string, path: string) => void;
  /** Focuses an already-open editor (tab single click). */
  readonly onActivateEditor: (entryId: string, path: string) => void;
  /** Pins an editor (tab double-click) so it stops being the preview tab. */
  readonly onPinEditor: (entryId: string, path: string) => void;
  /** Closes an editor (tab close control or middle click). */
  readonly onCloseEditor: (entryId: string, path: string) => void;
  /** Collapses the surface back to the chat-dominant layout. */
  readonly onCollapse: () => void;
  /**
   * The session {@link FileChange} that touched the open file, when it was
   * changed this session. When present the editor defaults to the authoritative
   * `baseline→candidate` diff (DD-06), matching the inspector's Viewer tab.
   */
  readonly change?: FileChange;
  /** Additional CSS classes for the root element. */
  readonly className?: string;
}

/**
 * A VS Code / Cursor-inspired read-only workspace surface: a slim activity rail
 * (Explorer / Search), a resizable sidebar, and a large editor area.
 *
 * This is the workspace-dominant counterpart to the inspector's cramped Viewer
 * tab. The session viewer flips its layout to give this surface the majority of
 * the screen while chat becomes a narrow column (see `SessionViewer`). It is a
 * self-contained organism: given `entries`, a `lister`, a `reader`, and the
 * open-file selection, it renders identically inside the Console or embedded in
 * a third-party host (DD-004). Explicitly read-only — no editing, no commit UI.
 *
 * All visual properties flow through `--stgm-*` tokens (DD-005).
 */
export function WorkspaceSurface({
  entries,
  lister,
  reader,
  editors,
  selectedFile,
  onOpenFile,
  onActivateEditor,
  onPinEditor,
  onCloseEditor,
  onCollapse,
  change,
  className,
}: WorkspaceSurfaceProps) {
  const [railView, setRailView] = useState<RailView>("files");

  return (
    <div className={cn("flex h-full min-h-0", className)}>
      <ActivityRail view={railView} onViewChange={setRailView} />
      <ResizableSplit
        resizablePane="primary"
        defaultSize={256}
        minSize={180}
        maxSize={480}
        storageKey="stgm-workspace-sidebar-width"
        ariaLabel="Resize file explorer"
        className="min-h-0 flex-1"
        primary={
          railView === "files" ? (
            <ExplorerSidebar
              entries={entries}
              lister={lister}
              selectedFile={selectedFile}
              onOpenFile={onOpenFile}
              onActivateFile={onPinEditor}
            />
          ) : (
            <SearchSidebar
              entries={entries}
              lister={lister}
              selectedFile={selectedFile}
              onOpenFile={onOpenFile}
            />
          )
        }
        secondary={
          <EditorArea
            entries={entries}
            reader={reader}
            editors={editors}
            selectedFile={selectedFile}
            change={change}
            onActivateEditor={onActivateEditor}
            onPinEditor={onPinEditor}
            onCloseEditor={onCloseEditor}
            onCollapse={onCollapse}
          />
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Activity rail — Explorer / Search switch (VS Code activity-bar model)
// ---------------------------------------------------------------------------

function ActivityRail({
  view,
  onViewChange,
}: {
  readonly view: RailView;
  readonly onViewChange: (next: RailView) => void;
}) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>) => {
      if (e.key === "ArrowDown" || e.key === "ArrowRight") {
        e.preventDefault();
        onViewChange("search");
      } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
        e.preventDefault();
        onViewChange("files");
      }
    },
    [onViewChange],
  );

  const items: readonly {
    readonly value: RailView;
    readonly label: string;
    readonly icon: React.ReactNode;
  }[] = [
    { value: "files", label: "Explorer", icon: <FilesIcon /> },
    { value: "search", label: "Search", icon: <SearchIcon /> },
  ];

  return (
    <div
      role="radiogroup"
      aria-label="Workspace view"
      aria-orientation="vertical"
      className="flex w-11 shrink-0 flex-col items-center gap-1 border-r border-border bg-muted-faint py-2"
    >
      {items.map((item) => {
        const isSelected = view === item.value;
        return (
          <button
            key={item.value}
            type="button"
            role="radio"
            aria-checked={isSelected}
            aria-label={item.label}
            title={item.label}
            tabIndex={isSelected ? 0 : -1}
            onClick={() => onViewChange(item.value)}
            onKeyDown={handleKeyDown}
            className={cn(
              "relative flex h-9 w-9 items-center justify-center rounded-md transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isSelected
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:bg-accent-hover hover:text-foreground",
            )}
          >
            {item.icon}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Explorer sidebar — multi-root file tree
// ---------------------------------------------------------------------------

function ExplorerSidebar({
  entries,
  lister,
  selectedFile,
  onOpenFile,
  onActivateFile,
}: {
  readonly entries: readonly WorkspaceEntry[];
  readonly lister: WorkspaceFileLister | undefined;
  readonly selectedFile: SelectedWorkspaceFile | null;
  readonly onOpenFile: (entryId: string, path: string) => void;
  readonly onActivateFile: (entryId: string, path: string) => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col border-r border-border">
      <SidebarHeader title="Explorer" />
      <div className="min-h-0 flex-1 overflow-y-auto py-1.5">
        {!lister || entries.length === 0 ? (
          <SidebarEmpty>No workspace attached.</SidebarEmpty>
        ) : (
          <ExplorerTree
            entries={entries}
            lister={lister}
            selectedFile={selectedFile}
            onOpenFile={onOpenFile}
            onActivateFile={onActivateFile}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Search sidebar — reuses the workspace-wide search surface
// ---------------------------------------------------------------------------

function SearchSidebar({
  entries,
  lister,
  selectedFile,
  onOpenFile,
}: {
  readonly entries: readonly WorkspaceEntry[];
  readonly lister: WorkspaceFileLister | undefined;
  readonly selectedFile: SelectedWorkspaceFile | null;
  readonly onOpenFile: (entryId: string, path: string) => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col border-r border-border">
      <SidebarHeader title="Search" />
      <WorkspaceFileSearch
        entries={entries}
        lister={lister}
        onOpenFile={onOpenFile}
        selectedFile={selectedFile}
        className="min-h-0 flex-1"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editor area — collapse control + tab strip + read-only FileViewer
// ---------------------------------------------------------------------------

function EditorArea({
  entries,
  reader,
  editors,
  selectedFile,
  change,
  onActivateEditor,
  onPinEditor,
  onCloseEditor,
  onCollapse,
}: {
  readonly entries: readonly WorkspaceEntry[];
  readonly reader: WorkspaceFileReader | undefined;
  readonly editors: readonly OpenEditor[];
  readonly selectedFile: SelectedWorkspaceFile | null;
  readonly change?: FileChange;
  readonly onActivateEditor: (entryId: string, path: string) => void;
  readonly onPinEditor: (entryId: string, path: string) => void;
  readonly onCloseEditor: (entryId: string, path: string) => void;
  readonly onCollapse: () => void;
}) {
  const viewerRef = useRef<FileViewerHandle>(null);
  const activeKey = selectedFile
    ? editorKey(selectedFile.entryId, selectedFile.path)
    : null;
  const activeEntryName = selectedFile
    ? entries.find((e) => e.id === selectedFile.entryId)?.name
    : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Collapse control + tab strip. The right side is kept clear (pr-24): the
          session viewer floats host `headerActions` (e.g. Share) over the
          top-right of this region. */}
      <div className="flex shrink-0 items-stretch border-b border-border pr-24">
        <button
          type="button"
          onClick={onCollapse}
          aria-label="Back to chat"
          title="Back to chat"
          className="flex shrink-0 items-center border-r border-border px-2 text-muted-foreground transition-colors hover:bg-accent-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <ChevronLeftIcon />
        </button>
        {editors.length > 0 && (
          <EditorTabs
            editors={editors}
            activeKey={activeKey}
            onActivate={onActivateEditor}
            onPin={onPinEditor}
            onClose={onCloseEditor}
            className="min-w-0 flex-1 border-b-0"
          />
        )}
      </div>
      {selectedFile ? (
        <>
          <Breadcrumbs
            entryName={activeEntryName}
            path={selectedFile.path}
            onRefresh={reader ? () => viewerRef.current?.refresh() : undefined}
          />
          {/* Per-file remount (key) resets scroll and view-mode state cleanly.
              The tab strip + breadcrumbs own the file identity, close, and
              refresh, so the viewer is chrome-less; Escape still collapses. */}
          <FileViewer
            ref={viewerRef}
            key={activeKey ?? undefined}
            selectedFile={selectedFile}
            entries={entries}
            reader={reader}
            change={change}
            onClose={onCollapse}
            showHeader={false}
            className="min-h-0 flex-1"
          />
        </>
      ) : (
        <div className="flex flex-1 items-center justify-center p-8 text-center text-xs text-muted-foreground">
          Select a file to view its contents.
        </div>
      )}
    </div>
  );
}

/**
 * Location breadcrumb for the active file: entry › folder › … › file, with an
 * optional refresh. Display-only orientation (clickable navigation is a future
 * enhancement); the refresh re-fetches the live file content.
 */
function Breadcrumbs({
  entryName,
  path,
  onRefresh,
}: {
  readonly entryName: string | undefined;
  readonly path: string;
  readonly onRefresh?: () => void;
}) {
  const segments = path.split("/").filter(Boolean);
  const crumbs = entryName ? [entryName, ...segments] : segments;

  return (
    <div className="flex shrink-0 items-center gap-1 border-b border-border-muted px-3 py-1 text-[0.65rem] text-muted-foreground">
      <nav aria-label="File location" className="flex min-w-0 flex-1 items-center gap-1">
        {crumbs.map((crumb, i) => {
          const isLast = i === crumbs.length - 1;
          return (
            <span key={i} className="flex min-w-0 items-center gap-1">
              {i > 0 && <span className="text-muted-foreground-subtle" aria-hidden="true">›</span>}
              <span className={cn("truncate", isLast && "text-foreground")}>
                {crumb}
              </span>
            </span>
          );
        })}
      </nav>
      {onRefresh && (
        <button
          type="button"
          onClick={onRefresh}
          aria-label="Reload file"
          title="Reload file"
          className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <RefreshIcon />
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared sidebar chrome
// ---------------------------------------------------------------------------

function SidebarHeader({ title }: { readonly title: string }) {
  return (
    <div className="shrink-0 border-b border-border px-3 py-2 text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">
      {title}
    </div>
  );
}

function SidebarEmpty({ children }: { readonly children: React.ReactNode }) {
  return (
    <div className="px-2 py-6 text-center text-xs text-muted-foreground">
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline SVG icons (SDK independence — no lucide dependency)
// ---------------------------------------------------------------------------

function FilesIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M13 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M13 3v5h5" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  );
}

function ChevronLeftIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 3L5 8L10 13" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1.5 6a4.5 4.5 0 017.794-3.073M10.5 6a4.5 4.5 0 01-7.794 3.073" />
      <path d="M9.5 1v2.5H7M2.5 11V8.5H5" />
    </svg>
  );
}
