"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ExecutionArtifact } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/artifact_pb";
import { ExecutionArtifactKind } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { cn } from "@stigmer/theme";
import { useArtifactContent } from "./useArtifactContent";
import { isTextArtifact, formatArtifactSize } from "./artifact-utils";
import { ArtifactContentRenderer } from "./ArtifactContentRenderer";
import { useDetectStigmerResource } from "../library/useDetectStigmerResource";
import { useDetectSkillPackage } from "../library/useDetectSkillPackage";
import type { SkillPackageDetection } from "../library/detect-skill-package";
import {
  useApplyResource,
  type ApplyResourceResult,
} from "../library/useApplyResource";

const COPIED_FEEDBACK_MS = 2000;

// ---------------------------------------------------------------------------
// ArtifactPreviewContent — standalone content component
// ---------------------------------------------------------------------------

/** Props for {@link ArtifactPreviewContent}. */
export interface ArtifactPreviewContentProps {
  /** The execution artifact to preview. */
  readonly artifact: ExecutionArtifact;
  /** ID of the execution that produced this artifact. */
  readonly executionId: string;
  /** Organization slug for the "Apply to [org]" / "Push Skill to [org]" CTA. */
  readonly org: string;
  /**
   * Whether the execution is in a terminal phase (completed, failed,
   * cancelled, terminated). Controls Apply/Push CTA availability:
   *
   * - `true` — CTA renders as an enabled primary button
   * - `false` — CTA renders as a disabled secondary button
   */
  readonly isTerminal: boolean;
  /** Called when the close button is clicked. */
  readonly onClose: () => void;
  /**
   * Called after a resource is successfully applied or a skill package
   * is pushed. The consumer can use this for post-apply behavior such
   * as showing a toast or navigating to the Library.
   */
  readonly onApplied?: (result: ApplyResourceResult) => void;
  /** Additional CSS classes for the root container. */
  readonly className?: string;
}

/**
 * Artifact preview content with detection pipeline and Apply/Push CTA.
 *
 * Renders the header (name, size, detection badge, close button),
 * content body (file content or directory listing), and action bar
 * (copy, download, Apply/Push). The parent is responsible for rendering
 * it inside a `<dialog>`, modal, sheet, overlay, or inline context as
 * needed.
 *
 * Orchestrates the same detection pipeline as {@link ArtifactCard}:
 *
 * - **FILE artifacts**: Fetches text content via {@link useArtifactContent},
 *   renders via {@link ArtifactContentRenderer} (markdown, YAML, JSON, or
 *   plain text based on file type), and detects Agent/McpServer resources
 *   via {@link useDetectStigmerResource}.
 *
 * - **DIRECTORY artifacts**: Shows the file listing from
 *   `artifact.entries` and detects skill packages via
 *   {@link useDetectSkillPackage}.
 *
 * Content fetching begins immediately on mount. Unmounting the component
 * resets all internal state (detection, apply result, clipboard). For
 * gated rendering (e.g. only when a dialog is open), conditionally
 * mount this component rather than passing an `active` flag.
 *
 * @example
 * ```tsx
 * // Inside a dialog, modal, or overlay:
 * <ArtifactPreviewContent
 *   artifact={artifact}
 *   executionId={execution.id}
 *   org={activeOrg}
 *   isTerminal={isTerminalPhase(execution.status?.phase)}
 *   onClose={() => setOpen(false)}
 *   onApplied={(result) => toast(`${result.kind} applied`)}
 * />
 * ```
 *
 * @see {@link ArtifactPreviewModal} — wraps this component in a native `<dialog>`
 * @see {@link ArtifactCard} — compact card that triggers preview via `onPreview`
 * @see {@link useArtifactContent} — content-fetching hook (headless alternative)
 * @see {@link useDetectStigmerResource} — YAML resource detection (headless)
 * @see {@link useDetectSkillPackage} — skill package detection (headless)
 * @see {@link useApplyResource} — apply/push behavior hook (headless)
 */
export function ArtifactPreviewContent({
  artifact,
  executionId,
  org,
  isTerminal,
  onClose,
  onApplied,
  className,
}: ArtifactPreviewContentProps) {
  const isDirectory = artifact.kind === ExecutionArtifactKind.DIRECTORY;
  const canFetchContent = !isDirectory && isTextArtifact(artifact);

  // ---------------------------------------------------------------------------
  // Detection orchestration
  // ---------------------------------------------------------------------------

  const {
    content,
    contentType,
    isTruncated,
    isLoading: isContentLoading,
    error: contentError,
  } = useArtifactContent(
    canFetchContent ? executionId : null,
    canFetchContent ? artifact.storageKey : null,
    undefined,
    artifact.contentHash || undefined,
  );

  const yamlDetection = useDetectStigmerResource(
    canFetchContent ? content : null,
  );

  const { detection: skillDetection, isLoading: isSkillLoading } =
    useDetectSkillPackage(
      isDirectory ? artifact : null,
      isDirectory ? executionId : null,
    );

  // ---------------------------------------------------------------------------
  // Derived detection state
  // ---------------------------------------------------------------------------

  const isDetected = yamlDetection.detected || skillDetection.detected;
  const isDetecting =
    (canFetchContent && isContentLoading) || (isDirectory && isSkillLoading);

  let detectionLabel: string | null = null;
  if (yamlDetection.detected) {
    detectionLabel = `${yamlDetection.displayName} detected`;
  } else if (skillDetection.detected) {
    const count = skillDetection.fileCount;
    detectionLabel = `Skill \u00B7 ${count} ${count === 1 ? "file" : "files"}`;
  }

  // ---------------------------------------------------------------------------
  // Apply state
  // ---------------------------------------------------------------------------

  const {
    applyYamlResource,
    pushSkillPackage,
    isApplying,
    error: applyError,
    clearError,
  } = useApplyResource();

  const [applyResult, setApplyResult] = useState<ApplyResourceResult | null>(
    null,
  );

  const handleApply = useCallback(async () => {
    clearError();
    try {
      let result: ApplyResourceResult;
      if (yamlDetection.detected && content) {
        result = await applyYamlResource(content, org);
      } else if (skillDetection.detected) {
        result = await pushSkillPackage({
          org,
          executionId,
          storageKey: artifact.storageKey,
        });
      } else {
        return;
      }
      setApplyResult(result);
      onApplied?.(result);
    } catch {
      // error state managed by useApplyResource
    }
  }, [
    yamlDetection.detected,
    skillDetection.detected,
    content,
    org,
    executionId,
    artifact.storageKey,
    applyYamlResource,
    pushSkillPackage,
    clearError,
    onApplied,
  ]);

  // ---------------------------------------------------------------------------
  // Copy to clipboard
  // ---------------------------------------------------------------------------

  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    if (!content) return;
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    });
  }, [content]);

  let ctaLabel: string | null = null;
  if (yamlDetection.detected) {
    ctaLabel = `Apply to ${org}`;
  } else if (skillDetection.detected) {
    ctaLabel = `Push Skill to ${org}`;
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className={cn("flex max-h-[80vh] flex-col", className)}>
      <ContentHeader
        artifact={artifact}
        isDirectory={isDirectory}
        detectionLabel={detectionLabel}
        isDetecting={isDetecting}
        onClose={onClose}
      />

      <div className="min-h-0 flex-1 overflow-y-auto border-t border-border">
        {isDirectory ? (
          <DirectoryContentView
            artifact={artifact}
            skillDetection={skillDetection}
          />
        ) : (
          <FileContentStateView
            artifact={artifact}
            content={content}
            contentType={contentType}
            isLoading={isContentLoading}
            error={contentError}
            isTruncated={isTruncated}
          />
        )}
      </div>

      <ActionBar
        artifact={artifact}
        isDirectory={isDirectory}
        hasContent={content !== null}
        copied={copied}
        onCopy={handleCopy}
        isDetected={isDetected}
        ctaLabel={ctaLabel}
        isTerminal={isTerminal}
        isApplying={isApplying}
        applyResult={applyResult}
        applyError={applyError}
        onApply={handleApply}
      />

      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {copied && "Content copied to clipboard"}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ArtifactPreviewModal — thin <dialog> shell
// ---------------------------------------------------------------------------

/** Props for {@link ArtifactPreviewModal}. */
export interface ArtifactPreviewModalProps {
  /** The execution artifact to preview. */
  readonly artifact: ExecutionArtifact;
  /** ID of the execution that produced this artifact. */
  readonly executionId: string;
  /** Organization slug for the "Apply to [org]" / "Push Skill to [org]" CTA. */
  readonly org: string;
  /**
   * Whether the execution is in a terminal phase (completed, failed,
   * cancelled, terminated). Controls Apply/Push CTA availability:
   *
   * - `true` — CTA renders as an enabled primary button
   * - `false` — CTA renders as a disabled secondary button
   */
  readonly isTerminal: boolean;
  /** Controls modal visibility. `true` opens the dialog via `showModal()`. */
  readonly open: boolean;
  /** Called when the modal should close (Escape key or close button). */
  readonly onClose: () => void;
  /**
   * Called after a resource is successfully applied or a skill package
   * is pushed. The consumer can use this for post-apply behavior such
   * as showing a toast or navigating to the Library.
   */
  readonly onApplied?: (result: ApplyResourceResult) => void;
  /** Additional CSS classes for the dialog element. */
  readonly className?: string;
}

/**
 * Full preview modal for execution artifacts using a native `<dialog>`.
 *
 * Thin shell around {@link ArtifactPreviewContent} that adds
 * `showModal()` / `close()` lifecycle, `::backdrop` overlay, focus
 * trap, and Escape key handling — with no dependency on
 * `@base-ui/react`.
 *
 * The content component is conditionally mounted when `open` is true,
 * so all internal state (detection, apply result, clipboard) resets
 * automatically when the dialog closes.
 *
 * @example
 * ```tsx
 * const [previewArtifact, setPreviewArtifact] =
 *   useState<ExecutionArtifact | null>(null);
 *
 * {previewArtifact && (
 *   <ArtifactPreviewModal
 *     artifact={previewArtifact}
 *     executionId={execution.id}
 *     org={activeOrg}
 *     isTerminal={isTerminalPhase(execution.status?.phase)}
 *     open
 *     onClose={() => setPreviewArtifact(null)}
 *     onApplied={(result) => toast(`${result.kind} applied`)}
 *   />
 * )}
 * ```
 *
 * @see {@link ArtifactPreviewContent} — the content component (use directly for non-dialog contexts)
 * @see {@link ArtifactCard} — compact card that triggers preview via `onPreview`
 */
export function ArtifactPreviewModal({
  artifact,
  executionId,
  org,
  isTerminal,
  open,
  onClose,
  onApplied,
  className,
}: ArtifactPreviewModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const handleCancel = useCallback(
    (e: React.SyntheticEvent) => {
      e.preventDefault();
      onClose();
    },
    [onClose],
  );

  return (
    <dialog
      ref={dialogRef}
      onCancel={handleCancel}
      aria-label={`Preview ${artifact.name}`}
      className={cn(
        "fixed inset-0 m-auto w-full max-w-3xl rounded-lg border border-border bg-background p-0 text-foreground shadow-lg outline-none",
        "[&::backdrop]:bg-black/50",
        className,
      )}
    >
      {open && (
        <ArtifactPreviewContent
          artifact={artifact}
          executionId={executionId}
          org={org}
          isTerminal={isTerminal}
          onClose={onClose}
          onApplied={onApplied}
        />
      )}
    </dialog>
  );
}

// ---------------------------------------------------------------------------
// Shared style constants
// ---------------------------------------------------------------------------

const FOCUS_RING_CLASSES =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded-sm";

// ---------------------------------------------------------------------------
// ContentHeader (internal)
// ---------------------------------------------------------------------------

function ContentHeader({
  artifact,
  isDirectory,
  detectionLabel,
  isDetecting,
  onClose,
}: {
  readonly artifact: ExecutionArtifact;
  readonly isDirectory: boolean;
  readonly detectionLabel: string | null;
  readonly isDetecting: boolean;
  readonly onClose: () => void;
}) {
  return (
    <div className="flex items-start gap-3 p-4 pb-3">
      <span className="mt-0.5 shrink-0 text-muted-foreground">
        {isDirectory ? <FolderIcon /> : <FileIcon />}
      </span>

      <div className="min-w-0 flex-1">
        <h2 className="truncate text-sm font-semibold text-foreground">
          {artifact.name}
          {isDirectory && "/"}
        </h2>
        <div className="mt-0.5 flex flex-wrap items-center gap-2">
          <span className="text-xs tabular-nums text-muted-foreground">
            {formatArtifactSize(artifact.sizeBytes)}
          </span>
          {isDetecting && !detectionLabel && (
            <span
              className="h-4 w-24 animate-pulse rounded-full bg-muted"
              aria-hidden="true"
            />
          )}
          {detectionLabel && (
            <span className="inline-flex items-center rounded-full bg-primary-subtle px-2 py-0.5 text-xs font-medium text-primary">
              {detectionLabel}
            </span>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={onClose}
        aria-label="Close preview"
        className={cn(
          "shrink-0 rounded-sm p-1 text-muted-foreground transition-colors hover:text-foreground",
          FOCUS_RING_CLASSES,
        )}
      >
        <CloseIcon />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FileContentStateView (internal — loading/error/empty states + renderer)
// ---------------------------------------------------------------------------

const SKELETON_LINE_WIDTHS = [85, 72, 90, 65, 78, 88, 70, 82] as const;

function FileContentStateView({
  artifact,
  content,
  contentType,
  isLoading,
  error,
  isTruncated,
}: {
  readonly artifact: ExecutionArtifact;
  readonly content: string | null;
  readonly contentType: string | null;
  readonly isLoading: boolean;
  readonly error: Error | null;
  readonly isTruncated: boolean;
}) {
  if (isLoading) {
    return (
      <div className="space-y-2 p-4" aria-busy="true" aria-label="Loading content">
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
      </div>
    );
  }

  if (content === null) {
    return (
      <div className="p-8 text-center text-sm text-muted-foreground">
        Content not available for preview.
      </div>
    );
  }

  return (
    <ArtifactContentRenderer
      content={content}
      fileName={artifact.name}
      contentType={contentType}
      isTruncated={isTruncated}
    />
  );
}

// ---------------------------------------------------------------------------
// DirectoryContentView (internal)
// ---------------------------------------------------------------------------

function DirectoryContentView({
  artifact,
  skillDetection,
}: {
  readonly artifact: ExecutionArtifact;
  readonly skillDetection: SkillPackageDetection;
}) {
  const entries = artifact.entries;

  return (
    <div className="p-4">
      {skillDetection.detected && (
        <div className="mb-4 rounded-md bg-primary-subtle p-3">
          <p className="text-sm font-medium text-foreground">
            {skillDetection.skillName}
          </p>
          {skillDetection.skillDescription && (
            <p className="mt-1 text-xs text-muted-foreground">
              {skillDetection.skillDescription}
            </p>
          )}
        </div>
      )}

      {entries.length > 0 ? (
        <div>
          <h3 className="mb-2 text-xs font-medium text-muted-foreground">
            Files ({entries.length})
          </h3>
          <ul className="space-y-0.5" role="list">
            {entries.map((entry) => (
              <li
                key={entry}
                className="flex items-center gap-2 rounded-sm px-2 py-1 font-mono text-xs text-foreground"
              >
                <EntryIcon name={entry} />
                <span className="min-w-0 truncate">{entry}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          File listing not available.
        </p>
      )}
    </div>
  );
}

function EntryIcon({ name }: { readonly name: string }) {
  if (name.endsWith("/")) return <FolderSmallIcon />;
  return <FileSmallIcon />;
}

// ---------------------------------------------------------------------------
// ActionBar (internal)
// ---------------------------------------------------------------------------

function ActionBar({
  artifact,
  isDirectory,
  hasContent,
  copied,
  onCopy,
  isDetected,
  ctaLabel,
  isTerminal,
  isApplying,
  applyResult,
  applyError,
  onApply,
}: {
  readonly artifact: ExecutionArtifact;
  readonly isDirectory: boolean;
  readonly hasContent: boolean;
  readonly copied: boolean;
  readonly onCopy: () => void;
  readonly isDetected: boolean;
  readonly ctaLabel: string | null;
  readonly isTerminal: boolean;
  readonly isApplying: boolean;
  readonly applyResult: ApplyResourceResult | null;
  readonly applyError: Error | null;
  readonly onApply: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3">
      <div className="flex items-center gap-3">
        {!isDirectory && hasContent && (
          <button
            type="button"
            onClick={onCopy}
            aria-label={copied ? "Copied to clipboard" : "Copy content"}
            className={cn(
              "inline-flex items-center gap-1.5 text-xs font-medium transition-colors",
              copied
                ? "text-success"
                : "text-muted-foreground hover:text-foreground",
              FOCUS_RING_CLASSES,
            )}
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
            {copied ? "Copied" : "Copy"}
          </button>
        )}

        <a
          href={artifact.downloadUrl}
          download
          className={cn(
            "inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground",
            FOCUS_RING_CLASSES,
          )}
        >
          <DownloadIcon />
          {isDirectory ? "Download ZIP" : "Download"}
        </a>
      </div>

      <div className="shrink-0">
        {applyResult ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-success">
            <CheckIcon />
            Applied {"\u00B7"} {applyResult.name || applyResult.kind}
          </span>
        ) : applyError ? (
          <span className="inline-flex items-center gap-2" role="alert">
            <span className="text-xs text-destructive">
              {applyError.message}
            </span>
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
        ) : isDetected && ctaLabel ? (
          <span data-cursor-target="apply-resource-button">
            <ApplyButton
              label={ctaLabel}
              isTerminal={isTerminal}
              isApplying={isApplying}
              onApply={onApply}
            />
          </span>
        ) : null}
      </div>
    </div>
  );
}

function ApplyButton({
  label,
  isTerminal,
  isApplying,
  onApply,
}: {
  readonly label: string;
  readonly isTerminal: boolean;
  readonly isApplying: boolean;
  readonly onApply: () => void;
}) {
  const canApply = isTerminal && !isApplying;

  return (
    <button
      type="button"
      onClick={canApply ? onApply : undefined}
      disabled={!canApply}
      aria-busy={isApplying}
      className={cn(
        "rounded-md px-4 py-1.5 text-xs font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        "disabled:cursor-not-allowed",
        canApply
          ? "bg-primary text-primary-foreground hover:bg-primary-hover"
          : "bg-muted text-muted-foreground",
      )}
    >
      {isApplying ? (
        <span className="inline-flex items-center gap-1.5">
          <SpinnerIcon />
          Applying{"\u2026"}
        </span>
      ) : (
        label
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Inline SVG icons (SDK pattern: no external icon dependency)
// ---------------------------------------------------------------------------

function CloseIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 3L11 11" />
      <path d="M11 3L3 11" />
    </svg>
  );
}

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

function FileSmallIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-muted-foreground"
      aria-hidden="true"
    >
      <path d="M8 1H4C3.45 1 3 1.45 3 2V12C3 12.55 3.45 13 4 13H10C10.55 13 11 12.55 11 12V4L8 1Z" />
      <path d="M8 1V4H11" />
    </svg>
  );
}

function FolderSmallIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-muted-foreground"
      aria-hidden="true"
    >
      <path d="M13 11C13 11.55 12.55 12 12 12H2C1.45 12 1 11.55 1 11V3C1 2.45 1.45 2 2 2H5L7 4H12C12.55 4 13 4.45 13 5V11Z" />
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

function SpinnerIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className="shrink-0 animate-spin"
      aria-hidden="true"
    >
      <path d="M6 1.5A4.5 4.5 0 1 1 1.5 6" strokeLinecap="round" />
    </svg>
  );
}

function ErrorAlertIcon() {
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
      className="text-destructive"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6.5" />
      <path d="M8 5.5V8.5" />
      <circle cx="8" cy="11" r="0.5" fill="currentColor" stroke="none" />
    </svg>
  );
}
