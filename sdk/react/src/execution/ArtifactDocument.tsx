"use client";

import type { ExecutionArtifact } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/artifact_pb";
import { cn } from "@stigmer/theme";
import { useArtifactInspection } from "./useArtifactInspection.js";
import { ArtifactContentBody } from "./ArtifactContentBody.js";
import { ArtifactApplyButton } from "./ArtifactApplyButton.js";
import { useArtifactDownload } from "./useArtifactDownload.js";
import { formatArtifactSize } from "./artifact-utils.js";
import type { ApplyResourceResult } from "../library/useApplyResource.js";

/** Props for {@link ArtifactDocument}. */
export interface ArtifactDocumentProps {
  /** The artifact to render. */
  readonly artifact: ExecutionArtifact;
  /** Execution that produced this artifact version (content + skill fetching). */
  readonly executionId: string;
  /** Organization for the "Apply to [org]" / "Push Skill to [org]" CTA. */
  readonly org: string;
  /**
   * Whether the producing execution is terminal. Gates the Apply/Push action
   * (a mid-run artifact's content may still change).
   */
  readonly isTerminal: boolean;
  /**
   * Called after a resource is applied or a skill pushed — the same host
   * callback the preview modal fires, so a document-apply behaves identically
   * (toast / Library refresh).
   */
  readonly onApplied?: (result: ApplyResourceResult) => void;
  /** Additional CSS classes for the root element. */
  readonly className?: string;
}

/**
 * The editor-pane rendering of a single execution artifact — the
 * {@link SurfaceVirtualDocument} counterpart of the {@link ArtifactPreviewModal}
 * popup, mounted as an artifact-family virtual document under
 * {@link ARTIFACT_DOCUMENT_ENTRY_ID}. Opening an artifact from the session
 * panel's Artifacts facet lands here (VS Code "each file is a tab") rather than
 * a modal.
 *
 * Shares the modal's exact behavior and body via the two extracted pieces —
 * {@link useArtifactInspection} (content + detection + apply/push + copy) and
 * {@link ArtifactContentBody} (loading / error / binary / text / directory) —
 * so the two surfaces can never drift. Only the chrome differs: a document
 * toolbar (name + size + detection badge; Copy / Download / Apply) over the
 * shared body, instead of the modal's header + footer action bar.
 *
 * Holds no must-survive local state: the panel region unmounts on collapse and
 * switching tabs remounts the active document, resetting transient apply/copy
 * state exactly as the modal resets on close. A `cacheKey` on the content fetch
 * keeps reopening a recently-viewed artifact instant (DD-014).
 *
 * All visual properties flow through `--stgm-*` tokens (DD-005).
 */
export function ArtifactDocument({
  artifact,
  executionId,
  org,
  isTerminal,
  onApplied,
  className,
}: ArtifactDocumentProps) {
  // Instant reopen: cache the content per (execution, storage key, version).
  // contentHash is included so a later overwrite of the same path never serves
  // a stale cached body.
  const cacheKey = `artifact-doc:${executionId}:${artifact.storageKey}:${artifact.contentHash}`;
  const inspection = useArtifactInspection(artifact, executionId, org, {
    cacheKey,
    onApplied,
  });
  const { download, isDownloading } = useArtifactDownload(executionId);

  const showCopy = !inspection.isDirectory && inspection.content !== null;

  return (
    <div
      role="article"
      aria-label={`Artifact ${artifact.name}`}
      className={cn("flex min-h-0 min-w-0 flex-1 flex-col", className)}
    >
      {/* Toolbar sticks to the top of the editor pane's scroll container so the
          file identity and actions stay visible while the body scrolls. Rows
          wrap on narrow panes (min-w-0 + flex-wrap) rather than forcing a
          horizontal scrollbar — the DD-20 reflow contract. */}
      <div className="sticky top-0 z-10 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border bg-background px-4 py-2">
        <span className="shrink-0 text-muted-foreground">
          {inspection.isDirectory ? <FolderIcon /> : <FileIcon />}
        </span>
        <span className="truncate text-sm font-medium text-foreground">
          {artifact.name}
          {inspection.isDirectory && "/"}
        </span>
        <span className="shrink-0 text-[0.65rem] tabular-nums text-muted-foreground-faint">
          {formatArtifactSize(artifact.sizeBytes)}
        </span>
        {inspection.isDetecting && !inspection.detectionLabel && (
          <span
            className="h-4 w-24 shrink-0 animate-pulse rounded-full bg-muted"
            aria-hidden="true"
          />
        )}
        {inspection.detectionLabel && (
          <span className="inline-flex shrink-0 items-center rounded-full bg-primary-subtle px-2 py-0.5 text-xs font-medium text-primary">
            {inspection.detectionLabel}
          </span>
        )}

        <div className="ml-auto flex min-w-0 flex-wrap items-center gap-3">
          {showCopy && (
            <button
              type="button"
              onClick={inspection.copy}
              aria-label={
                inspection.copied ? "Copied to clipboard" : "Copy content"
              }
              className={cn(
                "inline-flex items-center gap-1.5 text-xs font-medium transition-colors",
                inspection.copied
                  ? "text-success"
                  : "text-muted-foreground hover:text-foreground",
                FOCUS_RING_CLASSES,
              )}
            >
              {inspection.copied ? <CheckIcon /> : <CopyIcon />}
              {inspection.copied ? "Copied" : "Copy"}
            </button>
          )}
          <button
            type="button"
            onClick={() => download(artifact.storageKey, artifact.name)}
            disabled={isDownloading}
            className={cn(
              "inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50",
              FOCUS_RING_CLASSES,
            )}
          >
            <DownloadIcon />
            {isDownloading
              ? "Preparing\u2026"
              : inspection.isDirectory
                ? "Download ZIP"
                : "Download"}
          </button>
          <ApplyCluster
            isDetected={inspection.isDetected}
            ctaLabel={inspection.ctaLabel}
            isTerminal={isTerminal}
            isApplying={inspection.isApplying}
            applyResult={inspection.applyResult}
            applyError={inspection.applyError}
            onApply={inspection.apply}
          />
        </div>
      </div>

      <ArtifactContentBody
        artifact={artifact}
        content={inspection.content}
        contentType={inspection.contentType}
        isLoading={inspection.isLoading}
        error={inspection.error}
        isTruncated={inspection.isTruncated}
        skillDetection={inspection.skillDetection}
        className="min-w-0"
      />

      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {inspection.copied && "Content copied to clipboard"}
      </div>
    </div>
  );
}

/**
 * The Apply/Push affordance: the terminal-gated {@link ArtifactApplyButton}, or
 * the post-apply success / error-with-retry states. Mirrors the modal action
 * bar's apply cluster so both surfaces read identically.
 */
function ApplyCluster({
  isDetected,
  ctaLabel,
  isTerminal,
  isApplying,
  applyResult,
  applyError,
  onApply,
}: {
  readonly isDetected: boolean;
  readonly ctaLabel: string | null;
  readonly isTerminal: boolean;
  readonly isApplying: boolean;
  readonly applyResult: ApplyResourceResult | null;
  readonly applyError: Error | null;
  readonly onApply: () => void;
}) {
  if (applyResult) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-success">
        <CheckIcon />
        Applied {"\u00B7"} {applyResult.name || applyResult.kind}
      </span>
    );
  }
  if (applyError) {
    return (
      <span className="inline-flex items-center gap-2" role="alert">
        <span className="text-xs text-destructive">{applyError.message}</span>
        <button
          type="button"
          onClick={onApply}
          className={cn(
            "text-xs font-medium text-destructive underline transition-colors hover:text-destructive-muted",
            FOCUS_RING_CLASSES,
          )}
        >
          Retry
        </button>
      </span>
    );
  }
  if (isDetected && ctaLabel) {
    return (
      <span data-cursor-target="apply-resource-button">
        <ArtifactApplyButton
          label={ctaLabel}
          isTerminal={isTerminal}
          isApplying={isApplying}
          onApply={onApply}
        />
      </span>
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// Shared style constants
// ---------------------------------------------------------------------------

const FOCUS_RING_CLASSES =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded-sm";

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

function FolderIcon() {
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
      <path d="M14.5 12.5C14.5 13.33 13.83 14 13 14H3C2.17 14 1.5 13.33 1.5 12.5V3.5C1.5 2.67 2.17 2 3 2H6L8 4.5H13C13.83 4.5 14.5 5.17 14.5 6V12.5Z" />
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
      className="shrink-0"
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
      className="shrink-0"
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
      className="shrink-0"
      aria-hidden="true"
    >
      <path d="M2 6.5L4.5 9L10 3" />
    </svg>
  );
}
