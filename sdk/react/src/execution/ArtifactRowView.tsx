"use client";

// Pure presentational artifact list row shared by the session and workflow
// artifact facets. Domain: execution (data-model-agnostic — see ArtifactRowItem).

import { cn } from "@stigmer/theme";
import { FileTypeIcon, FolderTypeIcon } from "../internal/file-icons/index.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "../internal/tooltip.js";
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
    <li className={cn("stg:group stg:flex stg:items-stretch", className)}>
      {/* The open button is its own tooltip trigger (hover and keyboard focus
          both reveal the full path); the Download button's trigger is a
          wrapper span so the hint survives the in-flight `disabled` state
          (browsers suppress pointer events on disabled form controls, so a
          disabled button can never open its own tooltip). */}
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              onClick={onOpen}
              onDoubleClick={onActivate}
              className={cn(
                "stg:flex stg:min-w-0 stg:flex-1 stg:items-center stg:gap-2 stg:px-2 stg:py-1 stg:text-left stg:text-xs stg:text-muted-foreground stg:transition-colors",
                "stg:hover:bg-muted stg:hover:text-foreground",
                "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-inset stg:focus-visible:ring-ring",
              )}
            />
          }
        >
          <span className="stg:shrink-0 stg:text-muted-foreground">
            {item.isDirectory ? (
              <FolderTypeIcon open={false} />
            ) : (
              <FileTypeIcon fileName={item.name} />
            )}
          </span>
          <span className="stg:min-w-0 stg:flex-1 stg:truncate stg:text-foreground">
            {item.name}
            {item.isDirectory && "/"}
            {item.subtitlePath && (
              <span className="stg:ml-1.5 stg:text-[0.65rem] stg:text-muted-foreground">
                {item.subtitlePath}
              </span>
            )}
          </span>
          <span className="stg:shrink-0 stg:tabular-nums stg:text-[0.65rem] stg:text-muted-foreground-faint">
            {formatArtifactSize(item.sizeBytes)}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="stg:break-all">
          {item.tooltip}
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger render={<span className="stg:flex stg:shrink-0" />}>
          <button
            type="button"
            onClick={onDownload}
            disabled={isDownloading}
            aria-label={
              isDownloading ? `Preparing ${item.name}` : `Download ${item.name}`
            }
            className={cn(
              "stg:flex stg:shrink-0 stg:items-center stg:px-2 stg:text-muted-foreground stg:opacity-0 stg:transition-opacity",
              "stg:group-hover:opacity-100 stg:focus-visible:opacity-100",
              "stg:hover:text-foreground stg:disabled:opacity-50",
              "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-inset stg:focus-visible:ring-ring",
            )}
          >
            <DownloadIcon />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">
          {item.isDirectory ? "Download ZIP" : "Download"}
        </TooltipContent>
      </Tooltip>
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
      className="stg:shrink-0"
      aria-hidden="true"
    >
      <path d="M6 1.5V8.5" />
      <path d="M3 6L6 9L9 6" />
      <path d="M2 10.5H10" />
    </svg>
  );
}
