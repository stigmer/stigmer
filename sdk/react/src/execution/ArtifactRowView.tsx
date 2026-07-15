"use client";

// Pure presentational artifact list row shared by the session and workflow
// artifact facets. Domain: execution (data-model-agnostic — see ArtifactRowItem).

import { cn } from "@stigmer/theme";
import { FileTypeIcon, FolderTypeIcon } from "../internal/file-icons/index.js";
import type { ArtifactRowItem } from "./artifact-row-item.js";
import { formatArtifactSize } from "./artifact-utils.js";

/** Props for {@link ArtifactRowView}. */
export interface ArtifactRowViewProps {
  /** The view-model to render (see {@link ArtifactRowItem} adapters). */
  readonly item: ArtifactRowItem;
  /** Single click / Enter / Space: open the artifact (a preview tab, or a modal). */
  readonly onOpen: () => void;
  /**
   * Double click: promote the artifact to a persistent (pinned) tab. Mirrors the
   * file tree's `onOpenFile` (preview) / `onActivateFile` (pin) split — the
   * leading single click of the double click has already opened the preview, so
   * this promotes it. Omit in panel-less hosts (e.g. the modal-only widget):
   * with no handler the row binds no `onDoubleClick`, so a double click is just
   * two harmless single clicks, exactly as `FileTreeNode` behaves.
   */
  readonly onActivate?: () => void;
  /** Download the artifact (each host owns its own download mechanics). */
  readonly onDownload: () => void;
  /** `true` while the host's download is in flight — disables the control. */
  readonly isDownloading: boolean;
  /** Additional CSS classes for the row's `<li>`. */
  readonly className?: string;
}

/**
 * One dense, VS Code-style artifact row: a full-width open button (shared
 * file-type icon + name + optional disambiguation subtitle + size) with a
 * sibling, hover/focus-revealed Download button.
 *
 * The open target and the Download control are SIBLINGS, never nested — a
 * `<button>` inside a `<button>` is an axe `nested-interactive` (WCAG 4.1.2)
 * violation. This mirrors `ExplorerRoot`'s header + remove-control pattern.
 *
 * Deliberately data-model-agnostic: it renders an {@link ArtifactRowItem}
 * view-model and takes open/activate/download closures, so the session
 * (`ExecutionArtifact`) and workflow (`Artifact` resource) hosts share one row
 * UI without sharing a data model. The domain wrappers — session `ArtifactRow`
 * and workflow `WorkflowArtifactRow` — own identity, adapters, and download
 * wiring.
 *
 * All visual properties flow through `--stgm-*` tokens (DD-005).
 */
export function ArtifactRowView({
  item,
  onOpen,
  onActivate,
  onDownload,
  isDownloading,
  className,
}: ArtifactRowViewProps) {
  return (
    <li className={cn("group flex items-stretch", className)}>
      <button
        type="button"
        onClick={onOpen}
        onDoubleClick={onActivate}
        title={item.tooltip}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-2 px-2 py-1 text-left text-xs text-muted-foreground transition-colors",
          "hover:bg-muted hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        )}
      >
        <span className="shrink-0 text-muted-foreground">
          {item.isDirectory ? (
            <FolderTypeIcon open={false} />
          ) : (
            <FileTypeIcon fileName={item.name} />
          )}
        </span>
        <span className="min-w-0 flex-1 truncate text-foreground">
          {item.name}
          {item.isDirectory && "/"}
          {item.subtitlePath && (
            <span className="ml-1.5 text-[0.65rem] text-muted-foreground">
              {item.subtitlePath}
            </span>
          )}
        </span>
        <span className="shrink-0 tabular-nums text-[0.65rem] text-muted-foreground-faint">
          {formatArtifactSize(item.sizeBytes)}
        </span>
      </button>
      <button
        type="button"
        onClick={onDownload}
        disabled={isDownloading}
        aria-label={
          isDownloading ? `Preparing ${item.name}` : `Download ${item.name}`
        }
        title={item.isDirectory ? "Download ZIP" : "Download"}
        className={cn(
          "flex shrink-0 items-center px-2 text-muted-foreground opacity-0 transition-opacity",
          "group-hover:opacity-100 focus-visible:opacity-100",
          "hover:text-foreground disabled:opacity-50",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        )}
      >
        <DownloadIcon />
      </button>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Inline SVG icons (SDK independence — no lucide dependency)
// ---------------------------------------------------------------------------

function DownloadIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
      aria-hidden="true"
    >
      <path d="M6 1.5V8.5" />
      <path d="M3 6L6 9L9 6" />
      <path d="M2 10.5H10" />
    </svg>
  );
}
