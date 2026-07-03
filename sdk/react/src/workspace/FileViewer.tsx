"use client";

import { useCallback, type KeyboardEvent } from "react";
import { cn } from "@stigmer/theme";
import { ArtifactContentRenderer } from "../execution/ArtifactContentRenderer.js";
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
  /** Called when the user closes the viewer (close button or Escape). */
  readonly onClose?: () => void;
  /** Additional CSS classes for the root element. */
  readonly className?: string;
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
export function FileViewer({
  selectedFile,
  entries,
  reader,
  onClose,
  className,
}: FileViewerProps) {
  const entry = entries.find((e) => e.id === selectedFile.entryId) ?? null;
  const path = selectedFile.path;

  // The hook is called unconditionally — a missing entry passes `null` and the
  // hook stays idle, so hook order is stable across the not-found branch.
  const { content, isLoading, error, isUnsupported, refetch } =
    useWorkspaceFileContent({ entry, path, reader });

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
        <ViewerHeader
          basename={basename}
          dir={dir}
          onRefresh={undefined}
          onClose={onClose}
        />
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
      className={cn("flex h-full flex-col", className)}
      onKeyDown={handleKeyDown}
    >
      <ViewerHeader
        basename={basename}
        dir={dir}
        onRefresh={isUnsupported ? undefined : refetch}
        onClose={onClose}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <FileViewerBody
          basename={basename}
          content={content}
          isLoading={isLoading}
          isUnsupported={isUnsupported}
          error={error}
          onRetry={refetch}
        />
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
}: {
  readonly basename: string;
  readonly content: ReturnType<typeof useWorkspaceFileContent>["content"];
  readonly isLoading: boolean;
  readonly isUnsupported: boolean;
  readonly error: Error | null;
  readonly onRetry: () => void;
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
      <div className="space-y-2 p-4" aria-busy="true" aria-label="Loading file">
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
