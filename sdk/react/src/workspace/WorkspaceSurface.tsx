"use client";

import { useCallback, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
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

/** The built-in rail views every surface has. */
const BUILT_IN_VIEWS = ["files", "search"] as const;

/**
 * A host-injected rail view: an icon in the activity rail whose content
 * renders in the sidebar pane when active.
 *
 * This is how session facets (Config, Changes, Artifacts, …) join the built-in
 * Explorer/Search views without the surface knowing any session domain — the
 * same composition philosophy as the injected lister/reader capabilities
 * (DD-004). The surface stays an embeddable, domain-pure workspace organism;
 * hosts extend its rail.
 */
export interface SurfaceRailView {
  /** Unique view id. Must not collide with the built-in `"files"`/`"search"`. */
  readonly id: string;
  /** Accessible label; also rendered as the sidebar heading. */
  readonly label: string;
  /** Monochrome rail icon (tinted via `currentColor`, DD-005). */
  readonly icon: ReactNode;
  /** Optional count badge rendered over the rail icon (hidden when 0). */
  readonly badge?: number;
  /** Sidebar content rendered while this view is active. */
  readonly content: ReactNode;
}

/** Props for {@link WorkspaceSurface}. */
export interface WorkspaceSurfaceProps {
  /** The workspace entries whose files are browsable (multi-root). */
  readonly entries: readonly WorkspaceEntry[];
  /** Platform-injected file lister. `undefined` disables explorer + search. */
  readonly lister: WorkspaceFileLister | undefined;
  /** Platform-injected content reader for the editor. */
  readonly reader: WorkspaceFileReader | undefined;
  /**
   * The active rail view id (`"files"`, `"search"`, or an {@link SurfaceRailView.id}).
   * Provide together with `onViewChange` to control the rail from the host;
   * omit for internal (uncontrolled) view state. An id that matches no view
   * (e.g. a contextual extra view that disappeared) falls back to `"files"`.
   */
  readonly view?: string;
  /** Called when the user picks a rail view. */
  readonly onViewChange?: (viewId: string) => void;
  /**
   * Host-injected rail views, rendered after the built-in Explorer/Search.
   * Their `content` renders in the sidebar pane; the editor area stays for
   * files (the VS Code model).
   */
  readonly extraViews?: readonly SurfaceRailView[];
  /**
   * Detach a workspace entry. When provided, explorer root headers carry a
   * remove control (VS Code's "Remove Folder from Workspace").
   */
  readonly onRemoveEntry?: (entryId: string) => void;
  /**
   * Attach a local folder (host opens its native picker and adds the entry).
   * When provided, the explorer renders an "Add Folder" footer action —
   * desktop hosts wire this; web hosts omit it (no native picker).
   */
  readonly onAddLocalFolder?: () => void;
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
  view,
  onViewChange,
  extraViews,
  onRemoveEntry,
  onAddLocalFolder,
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
  // Optionally controlled (standard React pattern): a host that owns view
  // routing (e.g. the session panel's auto-view logic) passes `view` +
  // `onViewChange`; standalone embedders get internal state for free.
  const [uncontrolledView, setUncontrolledView] = useState<string>("files");
  const requestedView = view ?? uncontrolledView;
  const handleViewChange = useCallback(
    (next: string) => {
      setUncontrolledView(next);
      onViewChange?.(next);
    },
    [onViewChange],
  );

  // A stale id (e.g. a contextual extra view that disappeared) degrades to the
  // explorer rather than an empty sidebar.
  const isKnownView =
    (BUILT_IN_VIEWS as readonly string[]).includes(requestedView) ||
    (extraViews?.some((v) => v.id === requestedView) ?? false);
  const activeView = isKnownView ? requestedView : "files";
  const activeExtraView = extraViews?.find((v) => v.id === activeView);

  return (
    <div className={cn("flex h-full min-h-0", className)}>
      <ActivityRail
        view={activeView}
        onViewChange={handleViewChange}
        extraViews={extraViews}
      />
      <ResizableSplit
        resizablePane="primary"
        defaultSize={288}
        minSize={200}
        maxSize={560}
        storageKey="stgm-workspace-sidebar-width"
        ariaLabel="Resize sidebar"
        className="min-h-0 flex-1"
        primary={
          activeExtraView ? (
            <ExtraViewSidebar view={activeExtraView} />
          ) : activeView === "search" ? (
            <SearchSidebar
              entries={entries}
              lister={lister}
              selectedFile={selectedFile}
              onOpenFile={onOpenFile}
            />
          ) : (
            <ExplorerSidebar
              entries={entries}
              lister={lister}
              selectedFile={selectedFile}
              onOpenFile={onOpenFile}
              onActivateFile={onPinEditor}
              onRemoveEntry={onRemoveEntry}
              onAddLocalFolder={onAddLocalFolder}
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
// Activity rail — built-in views + host-injected extras (VS Code activity bar)
// ---------------------------------------------------------------------------

interface RailItem {
  readonly id: string;
  readonly label: string;
  readonly icon: ReactNode;
  readonly badge?: number;
}

function ActivityRail({
  view,
  onViewChange,
  extraViews,
}: {
  readonly view: string;
  readonly onViewChange: (next: string) => void;
  readonly extraViews: readonly SurfaceRailView[] | undefined;
}) {
  const items: readonly RailItem[] = [
    { id: "files", label: "Explorer", icon: <FilesIcon /> },
    { id: "search", label: "Search", icon: <SearchIcon /> },
    ...(extraViews ?? []),
  ];

  // Roving selection: arrows move relative to the *focused* item's position,
  // so the rail scales to any number of injected views.
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
      let nextIndex: number | null = null;
      if (e.key === "ArrowDown" || e.key === "ArrowRight") {
        nextIndex = Math.min(index + 1, items.length - 1);
      } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
        nextIndex = Math.max(index - 1, 0);
      }
      if (nextIndex === null || nextIndex === index) return;
      e.preventDefault();
      onViewChange(items[nextIndex].id);
    },
    [items, onViewChange],
  );

  return (
    <div
      role="radiogroup"
      aria-label="Workspace view"
      aria-orientation="vertical"
      className="flex w-11 shrink-0 flex-col items-center gap-1 border-r border-border bg-muted-faint py-2"
    >
      {items.map((item, index) => {
        const isSelected = view === item.id;
        const showBadge = item.badge != null && item.badge > 0;
        return (
          <button
            key={item.id}
            type="button"
            role="radio"
            aria-checked={isSelected}
            aria-label={showBadge ? `${item.label} (${item.badge})` : item.label}
            title={item.label}
            tabIndex={isSelected ? 0 : -1}
            onClick={() => onViewChange(item.id)}
            onKeyDown={(e) => handleKeyDown(e, index)}
            className={cn(
              "relative flex h-9 w-9 items-center justify-center rounded-md transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isSelected
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:bg-accent-hover hover:text-foreground",
            )}
          >
            {item.icon}
            {showBadge && (
              <span
                aria-hidden="true"
                className="absolute -right-0.5 -top-0.5 inline-flex min-w-[0.875rem] items-center justify-center rounded-full bg-primary px-1 py-px text-[9px] font-medium leading-none text-primary-foreground"
              >
                {item.badge}
              </span>
            )}
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
  onRemoveEntry,
  onAddLocalFolder,
}: {
  readonly entries: readonly WorkspaceEntry[];
  readonly lister: WorkspaceFileLister | undefined;
  readonly selectedFile: SelectedWorkspaceFile | null;
  readonly onOpenFile: (entryId: string, path: string) => void;
  readonly onActivateFile: (entryId: string, path: string) => void;
  readonly onRemoveEntry?: (entryId: string) => void;
  readonly onAddLocalFolder?: () => void;
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
            onRemoveEntry={onRemoveEntry}
          />
        )}
      </div>
      {onAddLocalFolder && (
        <div className="shrink-0 border-t border-border-muted p-1.5">
          <button
            type="button"
            onClick={onAddLocalFolder}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-foreground transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <FolderPlusIcon />
            <span className="flex-1 text-left">Add Folder</span>
          </button>
        </div>
      )}
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
// Extra-view sidebar — host-injected facet content (Config, Changes, …)
// ---------------------------------------------------------------------------

function ExtraViewSidebar({ view }: { readonly view: SurfaceRailView }) {
  return (
    <div className="flex h-full min-h-0 flex-col border-r border-border">
      <SidebarHeader title={view.label} />
      {/* Same scroll + padding envelope the inspector gave these components,
          so facet content drops in unchanged. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {view.content}
      </div>
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
      {/* Collapse control + tab strip. The far right is kept clear (pr-24):
          the session viewer floats its top-right controls (host
          `headerActions` and the panel chip) over this region. */}
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

function FolderPlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-muted-foreground" aria-hidden="true">
      <path d="M1.5 3.5V11a1 1 0 001 1h9a1 1 0 001-1V5.5a1 1 0 00-1-1H7L5.5 3H2.5a1 1 0 00-1 .5z" />
      <path d="M7 7v3M5.5 8.5h3" />
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
