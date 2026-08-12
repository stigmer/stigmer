"use client";

import {
  useCallback,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { cn } from "@stigmer/theme";
import type { FileChange } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { ResizableSplit } from "../internal/ResizableSplit.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../internal/tooltip.js";
import {
  editorKey,
  type OpenEditor,
  type OpenFileOptions,
  type SelectedWorkspaceFile,
} from "../internal/store/index.js";
import type { RevealTarget } from "../internal/useRevealLine.js";
import type { WorkspaceEntry } from "./useWorkspaceEntries.js";
import type { WorkspaceFileLister } from "./WorkspaceFileLister.js";
import type { WorkspaceFileReader } from "./WorkspaceFileReader.js";
import type { WorkspaceContentSearcher } from "./WorkspaceContentSearcher.js";
import { WorkspaceFileSearch } from "./WorkspaceFileSearch.js";
import { WorkspaceContentSearch } from "./WorkspaceContentSearch.js";
import { FileViewer, type FileViewerHandle } from "./FileViewer.js";
import { EditorTabs, editorTabDomId } from "./EditorTabs.js";
import { ExplorerTree } from "./ExplorerTree.js";

/** The surface's built-in rail views (offered by default, opt-out per host). */
const ALL_BUILT_IN_VIEWS = ["files", "search"] as const;

/** Identifier of a built-in rail view. */
export type BuiltInViewId = (typeof ALL_BUILT_IN_VIEWS)[number];

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
  /**
   * The content OWNS its chrome: render it in a bare full-height slot with
   * no sidebar header and no padded scroll wrapper. For self-managing views
   * — a header + fixed tab strip + internally-scrolling body (the workflow
   * Inspect facet) — where the default envelope would double the header and
   * nest scroll containers. Flat, single-scroll facets (Config, Changes,
   * Artifacts, Usage) omit it and keep the shared envelope.
   * @default false
   */
  readonly fitted?: boolean;
}

/**
 * A host-injected virtual document: an editor tab whose content is not a
 * workspace file — the session's `plan.md` today; execution artifacts are the
 * anticipated next family.
 *
 * The editor-area counterpart of {@link SurfaceRailView}'s rail injection
 * (DD-004): virtual documents share the tab group with file tabs (identical
 * open / pin / close / activate semantics through the same editors store),
 * and only the *body* rendering diverges — the surface renders `content`
 * instead of breadcrumbs + `FileViewer`. The surface stays domain-pure: it
 * matches tabs to virtual documents by identity and knows nothing about what
 * the document is.
 *
 * `entryId` must come from `virtualEntryId(kind)` so it can never alias a
 * real workspace entry; `path` doubles as the tab label's source (its
 * basename), matching file-tab behavior.
 */
export interface SurfaceVirtualDocument {
  /** Virtual entry id (from `virtualEntryId`) — the tab's owning "entry". */
  readonly entryId: string;
  /** Tab identity within the entry; its basename is the tab label. */
  readonly path: string;
  /** Editor-area content rendered while this document's tab is active. */
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
   * Platform-injected content (text) searcher. When provided, the Search pane
   * gains a `Name | Text` toggle offering full-text search; `undefined` (web/git
   * today) keeps the Search pane filename-only (DD-09). Mirrors the lister's
   * null contract — the honest "unavailable here" state.
   */
  readonly searcher?: WorkspaceContentSearcher;
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
   * Which built-in rail views the surface offers, in rail order. Defaults to
   * all of them; hosts without a workspace file source pass `[]` so the rail
   * carries only their injected `extraViews` — an honest facet-only surface
   * instead of inert Explorer/Search icons (DD-011: opt-in behavior change,
   * backward-compatible default). The workflow execution panel does this
   * until a workspace-source slice wires a lister.
   */
  readonly builtInViews?: readonly BuiltInViewId[];
  /**
   * Host-injected rail views, rendered after the built-in Explorer/Search.
   * Their `content` renders in the sidebar pane; the editor area stays for
   * files (the VS Code model).
   */
  readonly extraViews?: readonly SurfaceRailView[];
  /**
   * Host-injected virtual documents (see {@link SurfaceVirtualDocument}).
   * A tab whose identity matches one of these renders its `content` in the
   * editor area instead of the file viewer. The host opens/activates the tab
   * through the same editors-store seams as files.
   */
  readonly virtualDocuments?: readonly SurfaceVirtualDocument[];
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
   * `options.line` (content-search hits) requests a jump-to-line reveal.
   */
  readonly onOpenFile: (
    entryId: string,
    path: string,
    options?: OpenFileOptions,
  ) => void;
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
  /**
   * Jump-to-line reveal for the **active** editor (already scoped by the owner
   * to `reveal.key === activeKey`), or `undefined`. Forwarded to the editor's
   * viewer, which opens in File view and scrolls to / highlights the line.
   */
  readonly reveal?: RevealTarget;
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
  searcher,
  view,
  onViewChange,
  builtInViews = ALL_BUILT_IN_VIEWS,
  extraViews,
  virtualDocuments,
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
  reveal,
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
  // first OFFERED view rather than an empty sidebar — hardcoding "files" would
  // strand a builtInViews={[]} host on a view its rail doesn't render.
  const isKnownView =
    (builtInViews as readonly string[]).includes(requestedView) ||
    (extraViews?.some((v) => v.id === requestedView) ?? false);
  const fallbackView = builtInViews[0] ?? extraViews?.[0]?.id ?? "files";
  const activeView = isKnownView ? requestedView : fallbackView;
  const activeExtraView = extraViews?.find((v) => v.id === activeView);

  return (
    <div className={cn("stg:flex stg:h-full stg:min-h-0", className)}>
      <ActivityRail
        view={activeView}
        onViewChange={handleViewChange}
        builtInViews={builtInViews}
        extraViews={extraViews}
      />
      <ResizableSplit
        resizablePane="primary"
        defaultSize={288}
        minSize={200}
        maxSize={560}
        storageKey="stgm-workspace-sidebar-width"
        ariaLabel="Resize sidebar"
        // min-w-0: the split is a flex-row child of the surface; without it,
        // the fixed-width sidebar sub-pane gives the whole surface a hard
        // minimum width and content overflow escapes to the session panel.
        className="stg:min-h-0 stg:min-w-0 stg:flex-1"
        primary={
          activeExtraView ? (
            <ExtraViewSidebar view={activeExtraView} />
          ) : activeView === "search" ? (
            <SearchSidebar
              entries={entries}
              lister={lister}
              searcher={searcher}
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
            virtualDocuments={virtualDocuments}
            change={change}
            reveal={reveal}
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
  builtInViews,
  extraViews,
}: {
  readonly view: string;
  readonly onViewChange: (next: string) => void;
  readonly builtInViews: readonly BuiltInViewId[];
  readonly extraViews: readonly SurfaceRailView[] | undefined;
}) {
  const builtInItems: readonly RailItem[] = [
    { id: "files", label: "Explorer", icon: <FilesIcon /> },
    { id: "search", label: "Search", icon: <SearchIcon /> },
  ];
  const items: readonly RailItem[] = [
    ...builtInItems.filter((item) =>
      (builtInViews as readonly string[]).includes(item.id),
    ),
    ...(extraViews ?? []),
  ];

  // One ref per rail button so selection can move DOM focus with it (below).
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Roving radiogroup: selection follows focus. `keydown` fires on the focused
  // button, so its `index` is the current position; we select the neighbour AND
  // move focus to it. Moving focus is essential — without it focus stays pinned
  // on the entered button (whose index never changes) and every later view
  // (Config/Changes/…) is unreachable by keyboard.
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
      let nextIndex: number | null = null;
      if (e.key === "ArrowDown" || e.key === "ArrowRight") {
        nextIndex = Math.min(index + 1, items.length - 1);
      } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
        nextIndex = Math.max(index - 1, 0);
      } else if (e.key === "Home") {
        nextIndex = 0;
      } else if (e.key === "End") {
        nextIndex = items.length - 1;
      }
      if (nextIndex === null || nextIndex === index) return;
      e.preventDefault();
      onViewChange(items[nextIndex].id);
      buttonRefs.current[nextIndex]?.focus();
    },
    [items, onViewChange],
  );

  return (
    <TooltipProvider>
      <div
        role="radiogroup"
        aria-label="Workspace view"
        aria-orientation="vertical"
        className="stg:flex stg:w-11 stg:shrink-0 stg:flex-col stg:items-center stg:gap-1 stg:border-r stg:border-border stg:bg-muted-faint stg:py-2"
      >
        {items.map((item, index) => {
          const isSelected = view === item.id;
          const showBadge = item.badge != null && item.badge > 0;
          return (
            <Tooltip key={item.id}>
              <TooltipTrigger
                render={
                  <button
                    ref={(el) => {
                      buttonRefs.current[index] = el;
                    }}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    aria-label={showBadge ? `${item.label} (${item.badge})` : item.label}
                    tabIndex={isSelected ? 0 : -1}
                    onClick={() => onViewChange(item.id)}
                    onKeyDown={(e) => handleKeyDown(e, index)}
                    className={cn(
                      "stg:relative stg:flex stg:h-9 stg:w-9 stg:items-center stg:justify-center stg:rounded-md stg:transition-colors",
                      "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
                      isSelected
                        ? "stg:bg-accent stg:text-foreground"
                        : "stg:text-muted-foreground stg:hover:bg-accent-hover stg:hover:text-foreground",
                    )}
                  />
                }
              >
                {item.icon}
                {showBadge && (
                  <span
                    aria-hidden="true"
                    className="stg:absolute stg:-right-0.5 stg:-top-0.5 stg:inline-flex stg:min-w-[0.875rem] stg:items-center stg:justify-center stg:rounded-full stg:bg-primary stg:px-1 stg:py-px stg:text-[9px] stg:font-medium stg:leading-none stg:text-primary-foreground"
                  >
                    {item.badge}
                  </span>
                )}
              </TooltipTrigger>
              <TooltipContent side="right">{item.label}</TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
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
    <div className="stg:flex stg:h-full stg:min-h-0 stg:flex-col stg:border-r stg:border-border">
      <SidebarHeader title="Explorer" />
      <div className="stg:min-h-0 stg:flex-1 stg:overflow-y-auto stg:py-1.5">
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
        <div className="stg:shrink-0 stg:border-t stg:border-border-muted stg:p-1.5">
          <button
            type="button"
            onClick={onAddLocalFolder}
            className="stg:flex stg:w-full stg:items-center stg:gap-2 stg:rounded-md stg:px-2 stg:py-1.5 stg:text-xs stg:text-foreground stg:transition-colors stg:hover:bg-accent-hover stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring"
          >
            <FolderPlusIcon />
            <span className="stg:flex-1 stg:text-left">Add Folder</span>
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Search sidebar — reuses the workspace-wide search surface
// ---------------------------------------------------------------------------

type SearchMode = "name" | "text";

function SearchSidebar({
  entries,
  lister,
  searcher,
  selectedFile,
  onOpenFile,
}: {
  readonly entries: readonly WorkspaceEntry[];
  readonly lister: WorkspaceFileLister | undefined;
  readonly searcher: WorkspaceContentSearcher | undefined;
  readonly selectedFile: SelectedWorkspaceFile | null;
  readonly onOpenFile: (
    entryId: string,
    path: string,
    options?: OpenFileOptions,
  ) => void;
}) {
  // Filename search is the default: cached, instant, and always available.
  // Content (text) search is opt-in and only offered when a searcher exists.
  const [mode, setMode] = useState<SearchMode>("name");

  return (
    <div className="stg:flex stg:h-full stg:min-h-0 stg:flex-col stg:border-r stg:border-border">
      <SidebarHeader title="Search" />
      {searcher && <SearchModeToggle value={mode} onChange={setMode} />}
      {searcher && mode === "text" ? (
        <WorkspaceContentSearch
          entries={entries}
          searcher={searcher}
          onOpenFile={onOpenFile}
          selectedFile={selectedFile}
          className="stg:min-h-0 stg:flex-1"
        />
      ) : (
        <WorkspaceFileSearch
          entries={entries}
          lister={lister}
          onOpenFile={onOpenFile}
          selectedFile={selectedFile}
          className="stg:min-h-0 stg:flex-1"
        />
      )}
    </div>
  );
}

/**
 * `Name | Text` search-mode selector, mirroring `FileViewer`'s `Diff | File`
 * radiogroup (roving `tabindex`, arrow-key roving, `role="radio"`). Shown only
 * when a content searcher is injected.
 */
function SearchModeToggle({
  value,
  onChange,
}: {
  readonly value: SearchMode;
  readonly onChange: (next: SearchMode) => void;
}) {
  const options: readonly { readonly value: SearchMode; readonly label: string }[] = [
    { value: "name", label: "Name" },
    { value: "text", label: "Text" },
  ];

  // Selection follows focus, matching ActivityRail / ViewerModeToggle.
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const selectMode = useCallback(
    (next: SearchMode) => {
      onChange(next);
      buttonRefs.current[next === "name" ? 0 : 1]?.focus();
    },
    [onChange],
  );
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>) => {
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        selectMode("text");
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        selectMode("name");
      }
    },
    [selectMode],
  );

  return (
    <div className="stg:shrink-0 stg:border-b stg:border-border stg:px-2 stg:py-1.5">
      <div
        role="radiogroup"
        aria-label="Search mode"
        className="stg:inline-flex stg:rounded-md stg:bg-muted stg:p-0.5"
      >
        {options.map((option, index) => {
          const isSelected = value === option.value;
          return (
            <button
              key={option.value}
              ref={(el) => {
                buttonRefs.current[index] = el;
              }}
              type="button"
              role="radio"
              aria-checked={isSelected}
              tabIndex={isSelected ? 0 : -1}
              onClick={() => onChange(option.value)}
              onKeyDown={handleKeyDown}
              className={cn(
                "stg:rounded stg:px-2.5 stg:py-0.5 stg:text-[0.7rem] stg:font-medium stg:transition-colors",
                "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
                isSelected
                  ? "stg:bg-background stg:text-foreground stg:shadow-sm"
                  : "stg:text-muted-foreground stg:hover:text-foreground",
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Extra-view sidebar — host-injected facet content (Config, Changes, …)
// ---------------------------------------------------------------------------

function ExtraViewSidebar({ view }: { readonly view: SurfaceRailView }) {
  if (view.fitted) {
    // A fitted view owns its chrome (header, tab strip, scroll) — hand it a
    // bare full-height slot. A shared header or scroll wrapper here would
    // double the header and nest scroll containers around a component that
    // already manages both.
    return (
      <div className="stg:flex stg:h-full stg:min-h-0 stg:flex-col stg:border-r stg:border-border">
        {view.content}
      </div>
    );
  }
  return (
    <div className="stg:flex stg:h-full stg:min-h-0 stg:flex-col stg:border-r stg:border-border">
      <SidebarHeader title={view.label} />
      {/* Same scroll + padding envelope the inspector gave these components,
          so facet content drops in unchanged. */}
      <div className="stg:min-h-0 stg:flex-1 stg:overflow-y-auto stg:px-3 stg:py-3">
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
  virtualDocuments,
  change,
  reveal,
  onActivateEditor,
  onPinEditor,
  onCloseEditor,
  onCollapse,
}: {
  readonly entries: readonly WorkspaceEntry[];
  readonly reader: WorkspaceFileReader | undefined;
  readonly editors: readonly OpenEditor[];
  readonly selectedFile: SelectedWorkspaceFile | null;
  readonly virtualDocuments?: readonly SurfaceVirtualDocument[];
  readonly change?: FileChange;
  readonly reveal?: RevealTarget;
  readonly onActivateEditor: (entryId: string, path: string) => void;
  readonly onPinEditor: (entryId: string, path: string) => void;
  readonly onCloseEditor: (entryId: string, path: string) => void;
  readonly onCollapse: () => void;
}) {
  const viewerRef = useRef<FileViewerHandle>(null);
  // Instance-scoped ids tie each tab to the single editor body (tabpanel).
  const idBase = useId();
  const panelId = `${idBase}editor-panel`;
  const tabIdPrefix = `${idBase}editor-tab-`;
  const activeKey = selectedFile
    ? editorKey(selectedFile.entryId, selectedFile.path)
    : null;
  // The active tab is a virtual document when its identity matches an injected
  // one — the body renders the document's content instead of the file viewer.
  const activeVirtualDocument =
    activeKey !== null
      ? virtualDocuments?.find(
          (d) => editorKey(d.entryId, d.path) === activeKey,
        )
      : undefined;
  const activeEntryName = selectedFile
    ? entries.find((e) => e.id === selectedFile.entryId)?.name
    : undefined;

  return (
    <div className="stg:flex stg:h-full stg:min-h-0 stg:flex-col">
      {/* Collapse control + tab strip. The far right is kept clear (pr-24):
          the session viewer floats its top-right controls (host
          `headerActions` and the panel chip) over this region. */}
      <div className="stg:flex stg:shrink-0 stg:items-stretch stg:border-b stg:border-border stg:pr-24">
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                onClick={onCollapse}
                aria-label="Back to chat"
                className="stg:flex stg:shrink-0 stg:items-center stg:border-r stg:border-border stg:px-2 stg:text-muted-foreground stg:transition-colors stg:hover:bg-accent-hover stg:hover:text-foreground stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-inset stg:focus-visible:ring-ring"
              />
            }
          >
            <ChevronLeftIcon />
          </TooltipTrigger>
          <TooltipContent side="top">Back to chat</TooltipContent>
        </Tooltip>
        {editors.length > 0 && (
          <EditorTabs
            editors={editors}
            activeKey={activeKey}
            onActivate={onActivateEditor}
            onPin={onPinEditor}
            onClose={onCloseEditor}
            panelId={panelId}
            tabIdPrefix={tabIdPrefix}
            className="stg:min-w-0 stg:flex-1 stg:border-b-0"
          />
        )}
      </div>
      {/* The single editor body — the one tabpanel the tab strip controls (the
          content swaps; the panel is stable). role/labelledby apply only with an
          active tab (the empty state has no tab to label). Carries the same
          flex/min-w-0 chain as the branches so the DD-20 reflow is preserved:
          the wrapper is just a labelled passthrough, not a new layout context. */}
      <div
        className="stg:flex stg:min-h-0 stg:min-w-0 stg:flex-1 stg:flex-col"
        {...(activeKey
          ? {
              role: "tabpanel",
              id: panelId,
              "aria-labelledby": editorTabDomId(tabIdPrefix, activeKey),
            }
          : {})}
      >
        {activeVirtualDocument ? (
          // A virtual document owns its body wholesale: no breadcrumbs (there is
          // no filesystem location) and no FileViewer (there is no reader-backed
          // file). Keyed like files so switching documents resets cleanly.
          // Vertical-only scrolling: a lone overflow-y-auto would compute
          // overflow-x to auto too, giving the pane a horizontal scrollbar the
          // moment any child refuses to shrink — documents must reflow instead.
          <div
            key={activeKey ?? undefined}
            className="stg:min-h-0 stg:min-w-0 stg:flex-1 stg:overflow-y-auto stg:overflow-x-hidden"
          >
            {activeVirtualDocument.content}
          </div>
        ) : selectedFile ? (
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
              reveal={reveal}
              onClose={onCollapse}
              showHeader={false}
              className="stg:min-h-0 stg:flex-1"
            />
          </>
        ) : (
          <div className="stg:flex stg:flex-1 stg:items-center stg:justify-center stg:p-8 stg:text-center stg:text-xs stg:text-muted-foreground">
            Select a file to view its contents.
          </div>
        )}
      </div>
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
    <div className="stg:flex stg:shrink-0 stg:items-center stg:gap-1 stg:border-b stg:border-border-muted stg:px-3 stg:py-1 stg:text-[0.65rem] stg:text-muted-foreground">
      <nav aria-label="File location" className="stg:flex stg:min-w-0 stg:flex-1 stg:items-center stg:gap-1">
        {crumbs.map((crumb, i) => {
          const isLast = i === crumbs.length - 1;
          return (
            <span key={i} className="stg:flex stg:min-w-0 stg:items-center stg:gap-1">
              {i > 0 && <span className="stg:text-muted-foreground-subtle" aria-hidden="true">›</span>}
              <span className={cn("stg:truncate", isLast && "stg:text-foreground")}>
                {crumb}
              </span>
            </span>
          );
        })}
      </nav>
      {onRefresh && (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                onClick={onRefresh}
                aria-label="Reload file"
                className="stg:shrink-0 stg:rounded stg:p-0.5 stg:text-muted-foreground stg:transition-colors stg:hover:text-foreground stg:focus-visible:outline-none stg:focus-visible:ring-1 stg:focus-visible:ring-ring"
              />
            }
          >
            <RefreshIcon />
          </TooltipTrigger>
          <TooltipContent side="top">Reload file</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared sidebar chrome
// ---------------------------------------------------------------------------

function SidebarHeader({ title }: { readonly title: string }) {
  return (
    <div className="stg:shrink-0 stg:border-b stg:border-border stg:px-3 stg:py-2 stg:text-[0.65rem] stg:font-semibold stg:uppercase stg:tracking-wide stg:text-muted-foreground">
      {title}
    </div>
  );
}

function SidebarEmpty({ children }: { readonly children: React.ReactNode }) {
  return (
    <div className="stg:px-2 stg:py-6 stg:text-center stg:text-xs stg:text-muted-foreground">
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
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="stg:shrink-0 stg:text-muted-foreground" aria-hidden="true">
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
