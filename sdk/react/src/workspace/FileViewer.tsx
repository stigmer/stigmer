"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { cn } from "@stigmer/theme";
import type { FileChange } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { FileChangeType } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { ArtifactContentRenderer } from "../execution/ArtifactContentRenderer.js";
import { FileChangeDiff } from "../execution/FileChangesView.js";
import type { RevealTarget } from "../internal/useRevealLine.js";
import type { SelectedWorkspaceFile } from "../internal/store/workspace-file-selection-store.js";
import { useWorkspaceFileContent } from "./useWorkspaceFileContent.js";
import type { WorkspaceEntry } from "./useWorkspaceEntries.js";
import type { WorkspaceFileReader } from "./WorkspaceFileReader.js";

/** Line-skeleton widths, mirroring `FileContentStateView` in `ArtifactPreviewModal`. */
const SKELETON_LINE_WIDTHS = [85, 72, 90, 65, 78, 88, 70, 82] as const;

/** Props for {@link FileViewer}. */
export interface FileViewerProps {
  /** The file to display, keyed by owning entry id + path. */
  readonly selectedFile: SelectedWorkspaceFile;
  /**
   * Live workspace entries. The viewer resolves `selectedFile.entryId` against
   * this list, so a removed entry deselects into a gentle empty state rather
   * than reading a stale value.
   */
  readonly entries: readonly WorkspaceEntry[];
  /**
   * Platform-injected content reader. `undefined` means the host injects no
   * reader — the viewer shows an honest "not available here" state.
   */
  readonly reader: WorkspaceFileReader | undefined;
  /**
   * The session {@link FileChange} that touched this file, when it was changed
   * this session. When present the viewer defaults to the authoritative
   * `baseline→candidate` diff (DD-06) and — for a non-DELETE change with a
   * `reader` — offers a labeled toggle to the live "File" view. `undefined`
   * (the default) keeps the viewer a pure read-only browser (backward
   * compatible). Callers correlate the open file to its change with
   * `findChangeForSelection`; a platform builder can pass any `FileChange`.
   */
  readonly change?: FileChange;
  /**
   * Optional jump-to-line request (e.g. a content-search hit). When present the
   * viewer opens in the live **File** view — a line number refers to current
   * source, not the diff (DR-1) — with the `Diff | File` toggle still available,
   * and the matched line is scrolled into view and highlighted. A new `nonce`
   * re-forces File view and re-scrolls even on an already-open file. No-op when
   * the file is not live-browsable (a DELETE, or no `reader`).
   */
  readonly reveal?: RevealTarget;
  /** Called when the user closes the viewer (close button or Escape). */
  readonly onClose?: () => void;
  /**
   * Whether to render the built-in header (file name, refresh, close). Defaults
   * to `true` for standalone use. Set `false` when an outer chrome owns the file
   * identity and controls — e.g. the workspace surface, whose editor toolbar
   * (and, from Slice B, its tabs) show the name and collapse control, and where
   * a duplicate header would also collide with the floating `headerActions`
   * overlay. `onClose` still drives Escape-to-close even when the header (and
   * its close button) is hidden.
   */
  readonly showHeader?: boolean;
  /** Additional CSS classes for the root element. */
  readonly className?: string;
}

/**
 * Imperative handle for {@link FileViewer}. Lets an outer chrome (e.g. the
 * workspace surface's toolbar, which hides the built-in header) trigger a
 * re-fetch of the live file content without lifting the viewer's fetch state.
 */
export interface FileViewerHandle {
  /** Re-fetch the current file's live content. */
  readonly refresh: () => void;
}

/**
 * Read-only viewer for a single workspace file.
 *
 * A thin shell (no new rendering): it resolves the open file, drives
 * {@link useWorkspaceFileContent}, and — for displayable text — delegates to
 * the shared {@link ArtifactContentRenderer} (markdown / YAML / JSON /
 * line-numbered text). Its state body deliberately mirrors
 * `FileContentStateView` in `ArtifactPreviewModal` (same skeleton, error, and
 * delegation), extended with the three states an execution artifact never
 * has — binary, too-large, and unsupported-substrate. The two are **not**
 * merged into one shared component: their surrounding chrome (an artifact's
 * copy/download/apply bar vs. this viewer's header) differs enough that a
 * shared shell would need context-flag props. Keep them as sibling shells that
 * share the one renderer.
 *
 * Framework-agnostic and themed via `--stgm-*` tokens (DD-004/DD-005): a
 * platform builder can mount it directly given a `reader` and a selection.
 *
 * @example
 * ```tsx
 * <FileViewer
 *   selectedFile={{ entryId: entry.id, path: "src/index.ts" }}
 *   entries={workspace.entries}
 *   reader={workspaceFileReader}
 *   onClose={() => setSelected(null)}
 * />
 * ```
 */
export const FileViewer = forwardRef<FileViewerHandle, FileViewerProps>(
  function FileViewer(
    { selectedFile, entries, reader, change, reveal, onClose, showHeader = true, className },
    ref,
  ) {
  const entry = entries.find((e) => e.id === selectedFile.entryId) ?? null;
  const path = selectedFile.path;

  // The hook is called unconditionally — a missing entry passes `null` and the
  // hook stays idle, so hook order is stable across the not-found branch.
  const { content, isLoading, error, isUnsupported, refetch } =
    useWorkspaceFileContent({ entry, path, reader });

  useImperativeHandle(ref, () => ({ refresh: refetch }), [refetch]);

  // View mode is meaningful only for a changed file. A deleted file has no live
  // bytes to browse, and browsing needs a reader, so the live "File" view is
  // gated on both; otherwise a changed file shows the diff alone (no lone
  // control). The default is the authoritative diff (DD-06). The mount site
  // remounts the viewer per file (`key`), so this initializes correctly for
  // each opened file without deriving during render.
  const canBrowseLive = reader !== undefined && change?.changeType !== FileChangeType.DELETE;
  const showViewToggle = change !== undefined && canBrowseLive;
  // A reveal (jump-to-line) opens in File view even for a changed file — the
  // line number refers to current source, not the diff (DR-1). Absent a reveal,
  // a changed file still defaults to the authoritative diff (DD-06).
  const [viewMode, setViewMode] = useState<"diff" | "file">(
    reveal ? "file" : change !== undefined ? "diff" : "file",
  );
  // A new reveal on an already-mounted viewer (a second search hit in the same
  // file, so no remount) must return to File view to honor the line.
  useEffect(() => {
    if (reveal) setViewMode("file");
    // Keyed on the reveal nonce: only a fresh jump-to-line request re-forces
    // File view, so a manual switch to Diff afterward sticks.
  }, [reveal?.nonce]);
  const effectiveView: "diff" | "file" = change
    ? canBrowseLive
      ? viewMode
      : "diff"
    : "file";

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Escape" && onClose) {
        e.stopPropagation();
        onClose();
      }
    },
    [onClose],
  );

  const lastSlash = path.lastIndexOf("/");
  const basename = lastSlash >= 0 ? path.slice(lastSlash + 1) : path;
  const dir = lastSlash >= 0 ? path.slice(0, lastSlash) : "";

  // The owning entry is gone (removed while its file was open).
  if (!entry) {
    return (
      <div
        role="region"
        aria-label="File viewer"
        className={cn("flex h-full flex-col", className)}
        onKeyDown={handleKeyDown}
      >
        {showHeader && (
          <ViewerHeader
            basename={basename}
            dir={dir}
            onRefresh={undefined}
            onClose={onClose}
          />
        )}
        <div className="flex flex-1 items-center justify-center p-8 text-center text-xs text-muted-foreground">
          This file is no longer in the workspace.
        </div>
      </div>
    );
  }

  return (
    <div
      role="region"
      aria-label="File viewer"
      // Focusable (programmatically / on click) so the Escape-to-close handler
      // fires even when the read-only body holds no natively focusable element.
      tabIndex={-1}
      className={cn("flex h-full flex-col focus:outline-none", className)}
      onKeyDown={handleKeyDown}
    >
      {showHeader && (
        <ViewerHeader
          basename={basename}
          dir={dir}
          onRefresh={effectiveView === "file" && !isUnsupported ? refetch : undefined}
          onClose={onClose}
        />
      )}
      {showViewToggle && (
        <ViewerModeToggle value={viewMode} onChange={setViewMode} />
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {effectiveView === "diff" && change ? (
          <div className="p-3">
            <FileChangeDiff change={change} showFileName={false} showStats />
          </div>
        ) : (
          <>
            {change && (
              <p className="border-b border-border-muted px-4 py-1.5 text-[0.65rem] text-muted-foreground">
                Live — may differ from the reviewed change.
              </p>
            )}
            <FileViewerBody
              basename={basename}
              content={content}
              isLoading={isLoading}
              isUnsupported={isUnsupported}
              error={error}
              onRetry={refetch}
              reveal={reveal}
            />
          </>
        )}
      </div>
    </div>
  );
  },
);

// ---------------------------------------------------------------------------
// View toggle — Diff vs live File
// ---------------------------------------------------------------------------

/**
 * Segmented control for a changed file's two views: the authoritative reviewed
 * **Diff** and the live **File**. A mutually-exclusive choice, so it follows
 * the platform's radiogroup segmented-control pattern (see `library/ScopeToggle`)
 * rather than a tablist — it must not nest a second tablist inside the
 * inspector's own tabs.
 */
function ViewerModeToggle({
  value,
  onChange,
}: {
  readonly value: "diff" | "file";
  readonly onChange: (next: "diff" | "file") => void;
}) {
  const options: readonly { readonly value: "diff" | "file"; readonly label: string }[] = [
    { value: "diff", label: "Diff" },
    { value: "file", label: "File" },
  ];

  // Selection follows focus, matching ActivityRail / SearchModeToggle.
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const selectValue = useCallback(
    (next: "diff" | "file") => {
      onChange(next);
      buttonRefs.current[next === "diff" ? 0 : 1]?.focus();
    },
    [onChange],
  );
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>) => {
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        selectValue("file");
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        selectValue("diff");
      }
    },
    [selectValue],
  );

  return (
    <div className="border-b border-border px-3 py-1.5">
      <div
        role="radiogroup"
        aria-label="File view"
        className="inline-flex rounded-md bg-muted p-0.5"
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
                "inline-flex cursor-pointer items-center rounded-sm px-2 py-0.5 text-xs font-medium transition-colors",
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
    </div>
  );
}

// ---------------------------------------------------------------------------
// Body — exactly one state, mirroring FileContentStateView + workspace extras
// ---------------------------------------------------------------------------

function FileViewerBody({
  basename,
  content,
  isLoading,
  isUnsupported,
  error,
  onRetry,
  reveal,
}: {
  readonly basename: string;
  readonly content: ReturnType<typeof useWorkspaceFileContent>["content"];
  readonly isLoading: boolean;
  readonly isUnsupported: boolean;
  readonly error: Error | null;
  readonly onRetry: () => void;
  readonly reveal?: RevealTarget;
}) {
  // Unsupported comes first: a missing reader means there is nothing to load.
  if (isUnsupported) {
    return (
      <MessageState>
        Preview isn&rsquo;t available for this file here.
      </MessageState>
    );
  }

  if (isLoading) {
    return (
      <div
        role="status"
        className="space-y-2 p-4"
        aria-busy="true"
        aria-label="Loading file"
      >
        {SKELETON_LINE_WIDTHS.map((width, i) => (
          <div
            key={i}
            className="h-4 animate-pulse rounded bg-muted"
            style={{ width: `${width}%` }}
            aria-hidden="true"
          />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 p-8 text-center">
        <ErrorAlertIcon />
        <p className="text-sm text-destructive">{error.message}</p>
        <button
          type="button"
          onClick={onRetry}
          className="text-xs font-medium text-foreground underline underline-offset-2 hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded-sm"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!content) {
    // Not loading, not unsupported, no error, yet no content — defensive.
    return <MessageState>Content not available for preview.</MessageState>;
  }

  if (content.isBinary) {
    return (
      <MessageState>
        Binary file — not shown{content.size ? ` (${formatBytes(content.size)})` : ""}.
      </MessageState>
    );
  }

  if (content.text === null && content.truncated) {
    return (
      <MessageState>
        This file is too large to preview
        {content.size ? ` (${formatBytes(content.size)})` : ""}.
      </MessageState>
    );
  }

  if (content.text === null) {
    return <MessageState>This file can&rsquo;t be displayed as text.</MessageState>;
  }

  return (
    <ArtifactContentRenderer
      content={content.text}
      fileName={basename}
      isTruncated={content.truncated}
      reveal={reveal}
    />
  );
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function ViewerHeader({
  basename,
  dir,
  onRefresh,
  onClose,
}: {
  readonly basename: string;
  readonly dir: string;
  readonly onRefresh?: () => void;
  readonly onClose?: () => void;
}) {
  return (
    <div className="flex items-center gap-2 border-b border-border px-3 py-2">
      <FileIcon />
      <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
        <span className="truncate text-xs font-semibold text-foreground" title={dir ? `${dir}/${basename}` : basename}>
          {basename}
        </span>
        {dir && (
          <span className="truncate text-[0.65rem] text-muted-foreground">{dir}</span>
        )}
      </div>
      {onRefresh && (
        <button
          type="button"
          onClick={onRefresh}
          aria-label={`Reload ${basename}`}
          className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <RefreshIcon />
        </button>
      )}
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Close file viewer"
          className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <CloseIcon />
        </button>
      )}
    </div>
  );
}

function MessageState({ children }: { readonly children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-8 text-center text-xs text-muted-foreground">
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Human-readable byte size for the too-large / binary states. */
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Inline SVG icons (SDK independence — no lucide dependency)
// ---------------------------------------------------------------------------

function FileIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-muted-foreground" aria-hidden="true">
      <path d="M9.5 1.5H5C4.17 1.5 3.5 2.17 3.5 3V13C3.5 13.83 4.17 14.5 5 14.5H11C11.83 14.5 12.5 13.83 12.5 13V4.5L9.5 1.5Z" />
      <path d="M9.5 1.5V4.5H12.5" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 3L11 11" />
      <path d="M11 3L3 11" />
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

function ErrorAlertIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-destructive" aria-hidden="true">
      <circle cx="8" cy="8" r="6.5" />
      <path d="M8 5.5V8.5" />
      <circle cx="8" cy="11" r="0.5" fill="currentColor" stroke="none" />
    </svg>
  );
}
