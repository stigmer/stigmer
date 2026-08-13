"use client";

// Editor-area document rendering one workflow Artifact resource's content.
// Domain: workflow (the Artifact-resource counterpart of execution/ArtifactDocument).

import { useCallback } from "react";
import type { Artifact } from "@stigmer/protos/ai/stigmer/agentic/artifact/v1/api_pb";
import { cn } from "@stigmer/theme";
import { ArtifactFileContent } from "../execution/ArtifactFileContent.js";
import { formatArtifactSize } from "../execution/artifact-utils.js";
import { useArtifactContentById } from "../execution/useArtifactContentById.js";
import { useCopyFeedback } from "../internal/useCopyFeedback.js";
import { useWorkflowArtifactDownload } from "./useWorkflowArtifactDownload.js";

/** Props for {@link WorkflowArtifactDocument}. */
export interface WorkflowArtifactDocumentProps {
  /** The workflow artifact to render. */
  readonly artifact: Artifact;
  /** Additional CSS classes for the root element. */
  readonly className?: string;
}

/**
 * MIME types whose content is fetchable and renderable as text. The `Artifact`
 * spec requires a content type at creation, so gating is MIME-first — unlike
 * the session model, which infers text-ness from the file extension.
 */
function isTextContentType(contentType: string): boolean {
  const ct = contentType.toLowerCase();
  return (
    ct.startsWith("text/") ||
    ct.includes("json") ||
    ct.includes("yaml") ||
    ct.includes("xml") ||
    ct.includes("markdown") ||
    ct.includes("csv")
  );
}

/**
 * The editor-pane rendering of a single workflow `Artifact` resource — the
 * `SurfaceVirtualDocument` body the workflow execution panel mounts when an
 * artifact opens from its Artifacts facet (VS Code "each file is a tab").
 *
 * The `Artifact`-resource counterpart of the session's `ArtifactDocument`:
 * same toolbar-over-body shape and the same shared file-content states
 * ({@link ArtifactFileContent}), but file-only (the resource model has no
 * directory concept) and deliberately read-only — no resource detection and
 * no Apply/Push, which are session-specific product features.
 *
 * Content is fetched through `stigmer.artifact.getContent` (server-proxied
 * bytes, CORS-safe for embedded hosts) only for text content types; binary
 * artifacts show an honest "not available for preview" body with Download as
 * the escape hatch. A `cacheKey` keeps reopening a recently-viewed tab
 * instant (DD-014).
 *
 * All visual properties flow through `--stgm-*` tokens (DD-005).
 */
export function WorkflowArtifactDocument({
  artifact,
  className,
}: WorkflowArtifactDocumentProps) {
  const id = artifact.metadata?.id ?? "";
  const displayName =
    artifact.spec?.displayName || artifact.metadata?.name || "Unnamed";
  const specContentType = artifact.spec?.contentType ?? "";
  const sizeBytes = artifact.status?.sizeBytes ?? BigInt(0);

  const canFetchContent = !!id && isTextContentType(specContentType);
  const { content, contentType, isTruncated, isLoading, error } =
    useArtifactContentById(
      canFetchContent ? id : null,
      // Artifacts are immutable after creation (append-only store), so the id
      // alone is a safe cache identity — no contentHash needed.
      canFetchContent ? `workflow-artifact-doc:${id}` : undefined,
    );

  const { download, isDownloading } = useWorkflowArtifactDownload();

  const { copy: copyToClipboard, copied } = useCopyFeedback();
  const copy = useCallback(() => {
    if (!content) return;
    void copyToClipboard(content);
  }, [content, copyToClipboard]);

  const showCopy = content !== null;

  return (
    <div
      role="article"
      aria-label={`Artifact ${displayName}`}
      className={cn("stg:flex stg:min-h-0 stg:min-w-0 stg:flex-1 stg:flex-col", className)}
    >
      {/* Toolbar sticks to the top of the editor pane's scroll container so the
          file identity and actions stay visible while the body scrolls. Rows
          wrap on narrow panes (min-w-0 + flex-wrap) rather than forcing a
          horizontal scrollbar — the DD-20 reflow contract. */}
      <div className="stg:sticky stg:top-0 stg:z-10 stg:flex stg:min-w-0 stg:flex-wrap stg:items-center stg:gap-x-3 stg:gap-y-1.5 stg:border-b stg:border-border stg:bg-background stg:px-4 stg:py-2">
        <span className="stg:shrink-0 stg:text-muted-foreground">
          <FileIcon />
        </span>
        <span className="stg:truncate stg:text-sm stg:font-medium stg:text-foreground">
          {displayName}
        </span>
        <span className="stg:shrink-0 stg:text-[0.65rem] stg:tabular-nums stg:text-muted-foreground-faint">
          {formatArtifactSize(sizeBytes)}
        </span>
        {specContentType && (
          <span className="stg:shrink-0 stg:text-[0.65rem] stg:text-muted-foreground">
            {specContentType}
          </span>
        )}

        <div className="stg:ml-auto stg:flex stg:min-w-0 stg:flex-wrap stg:items-center stg:gap-3">
          {showCopy && (
            <button
              type="button"
              onClick={copy}
              aria-label={copied ? "Copied to clipboard" : "Copy content"}
              className={cn(
                "stg:inline-flex stg:items-center stg:gap-1.5 stg:text-xs stg:font-medium stg:transition-colors",
                copied
                  ? "stg:text-success"
                  : "stg:text-muted-foreground stg:hover:text-foreground",
                FOCUS_RING_CLASSES,
              )}
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
              {copied ? "Copied" : "Copy"}
            </button>
          )}
          <button
            type="button"
            onClick={() => download(id)}
            disabled={isDownloading || !id}
            className={cn(
              "stg:inline-flex stg:items-center stg:gap-1.5 stg:text-xs stg:font-medium stg:text-muted-foreground stg:transition-colors stg:hover:text-foreground stg:disabled:opacity-50",
              FOCUS_RING_CLASSES,
            )}
          >
            <DownloadIcon />
            {isDownloading ? "Preparing\u2026" : "Download"}
          </button>
        </div>
      </div>

      <div className="stg:min-w-0">
        <ArtifactFileContent
          fileName={displayName}
          content={content}
          contentType={contentType ?? specContentType}
          isLoading={isLoading}
          error={error}
          isTruncated={isTruncated}
        />
      </div>

      <div role="status" aria-live="polite" aria-atomic="true" className="stg:sr-only">
        {copied && "Content copied to clipboard"}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared style constants
// ---------------------------------------------------------------------------

const FOCUS_RING_CLASSES =
  "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring stg:focus-visible:rounded-sm";

// ---------------------------------------------------------------------------
// Inline SVG icons (SDK independence — no lucide dependency)
// ---------------------------------------------------------------------------

function FileIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9.5 1.5H5C4.17 1.5 3.5 2.17 3.5 3V13C3.5 13.83 4.17 14.5 5 14.5H11C11.83 14.5 12.5 13.83 12.5 13V4.5L9.5 1.5Z" />
      <path d="M9.5 1.5V4.5H12.5" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="stg:shrink-0"
      aria-hidden="true"
    >
      <rect x="4" y="4" width="6.5" height="6.5" rx="1" />
      <path d="M8 4V2.5C8 1.95 7.55 1.5 7 1.5H2.5C1.95 1.5 1.5 1.95 1.5 2.5V7C1.5 7.55 1.95 8 2.5 8H4" />
    </svg>
  );
}

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

function CheckIcon() {
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
      <path d="M2 6.5L4.5 9L10 3" />
    </svg>
  );
}
