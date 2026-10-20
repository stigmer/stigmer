"use client";

import { useCallback } from "react";
import type { File as StigmerFile } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { cn } from "@stigmer/design-tokens";
import { DialogShell } from "../internal/DialogShell.js";
import { useFileDownload } from "../file/useFile.js";
import { formatArtifactSize } from "./artifact-utils.js";
import { ArtifactContentBody } from "./ArtifactContentBody.js";
import { ArtifactApplyButton } from "./ArtifactApplyButton.js";
import { useArtifactInspection } from "./useArtifactInspection.js";
import type { ApplyResourceResult } from "../library/useApplyResource.js";

// ---------------------------------------------------------------------------
// ArtifactPreviewContent — standalone content component
// ---------------------------------------------------------------------------

/** Props for {@link ArtifactPreviewContent}. */
export interface ArtifactPreviewContentProps {
  /** The File to preview. */
  readonly file: StigmerFile;
  /** Organization id for the "Apply to [org]" CTA (a slug is also accepted). */
  readonly org: string;
  /**
   * Whether the run that returned the File has ended. Controls Apply CTA
   * availability:
   *
   * - `true` — CTA renders as an enabled primary button
   * - `false` — CTA renders as a disabled secondary button
   */
  readonly isTerminal: boolean;
  /** Called when the close button is clicked. */
  readonly onClose: () => void;
  /**
   * Called after a resource is successfully applied. The consumer can use
   * this for post-apply behavior such as showing a toast or navigating to
   * the Library.
   */
  readonly onApplied?: (result: ApplyResourceResult) => void;
  /**
   * Optional plan-build action. When provided, a "Build" primary button
   * appears in the action bar (used for a plan: turn the plan into a Run).
   * Clicking it calls `onImplement` then closes the modal. Omit for
   * non-actionable Files.
   */
  readonly onImplement?: () => void;
  /** Additional CSS classes for the root container. */
  readonly className?: string;
}

/**
 * Output-File preview content with detection pipeline and Apply CTA.
 *
 * Renders the header (name, size, detection badge, close button),
 * content body, and action bar (copy, download, Apply). The parent is responsible for rendering
 * it inside a `<dialog>`, modal, sheet, overlay, or inline context as
 * needed.
 *
 * Orchestrates the shared detection pipeline (see {@link useArtifactInspection}):
 *
 * it reads a text File via `useFileContent`, renders it via
 * {@link ArtifactContentRenderer} (markdown, YAML, JSON, or plain text based
 * on file type), and detects Agent resources via
 * {@link useDetectStigmerResource}.
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
 *   file={file}
 *   org={activeOrg}
 *   isTerminal={isTerminalPhase(run.status?.phase)}
 *   onClose={() => setOpen(false)}
 *   onApplied={(result) => toast(`${result.kind} applied`)}
 * />
 * ```
 *
 * @see {@link ArtifactPreviewModal} — wraps this component in a native `<dialog>`
 * @see {@link ArtifactRow} — dense list row that triggers preview via `onOpen`
 * @see {@link useDetectStigmerResource} — YAML resource detection (headless)
 * @see {@link useApplyResource} — apply behavior hook (headless)
 */
export function ArtifactPreviewContent({
  file,
  org,
  isTerminal,
  onClose,
  onApplied,
  onImplement,
  className,
}: ArtifactPreviewContentProps) {
  // The whole inspect-and-act pipeline (content, detection, apply, copy)
  // lives in one headless hook, shared with the editor-area ArtifactDocument so
  // the two surfaces can never drift.
  const inspection = useArtifactInspection(file, org, { onApplied });

  // "Build" runs the plan; closing the modal lets the host's submit pipeline
  // take over (switch to Agent + send). Single combined handler keeps the
  // caller's contract simple ("just give me onImplement").
  const handleImplement = useCallback(() => {
    onImplement?.();
    onClose();
  }, [onImplement, onClose]);

  return (
    <div className={cn("stg:flex stg:max-h-[80vh] stg:flex-col", className)}>
      <ContentHeader
        file={file}
        detectionLabel={inspection.detectionLabel}
        isDetecting={inspection.isDetecting}
        onClose={onClose}
      />

      <ArtifactContentBody
        file={file}
        content={inspection.content}
        contentType={inspection.contentType}
        isLoading={inspection.isLoading}
        error={inspection.error}
        isTruncated={inspection.isTruncated}
        className="stg:min-h-0 stg:flex-1 stg:overflow-y-auto stg:border-t stg:border-border"
      />

      <ActionBar
        file={file}
        hasContent={inspection.content !== null}
        copied={inspection.copied}
        onCopy={inspection.copy}
        isDetected={inspection.isDetected}
        ctaLabel={inspection.ctaLabel}
        isTerminal={isTerminal}
        isApplying={inspection.isApplying}
        applyResult={inspection.applyResult}
        applyError={inspection.applyError}
        onApply={inspection.apply}
        onImplement={onImplement ? handleImplement : undefined}
      />

      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="stg:sr-only"
      >
        {inspection.copied && "Content copied to clipboard"}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ArtifactPreviewModal — thin <dialog> shell
// ---------------------------------------------------------------------------

/** Props for {@link ArtifactPreviewModal}. */
export interface ArtifactPreviewModalProps {
  /** The File to preview. */
  readonly file: StigmerFile;
  /** Organization id for the "Apply to [org]" CTA (a slug is also accepted). */
  readonly org: string;
  /**
   * Whether the run that returned the File has ended. Controls Apply CTA
   * availability:
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
   * Called after a resource is successfully applied. The consumer can use
   * this for post-apply behavior such as showing a toast or navigating to
   * the Library.
   */
  readonly onApplied?: (result: ApplyResourceResult) => void;
  /**
   * Optional plan-build action (see {@link ArtifactPreviewContentProps.onImplement}).
   * When provided, a "Build" primary button appears; clicking it calls
   * `onImplement` then closes the modal.
   */
  readonly onImplement?: () => void;
  /** Additional CSS classes for the dialog element. */
  readonly className?: string;
}

/**
 * Full preview modal for an output File using a native `<dialog>`.
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
 * const [previewFile, setPreviewFile] = useState<File | null>(null);
 *
 * {previewFile && (
 *   <ArtifactPreviewModal
 *     file={previewFile}
 *     org={activeOrg}
 *     isTerminal={isTerminalPhase(run.status?.phase)}
 *     open
 *     onClose={() => setPreviewFile(null)}
 *     onApplied={(result) => toast(`${result.kind} applied`)}
 *   />
 * )}
 * ```
 *
 * @see {@link ArtifactPreviewContent} — the content component (use directly for non-dialog contexts)
 * @see {@link ArtifactRow} — dense list row that triggers preview via `onOpen`
 */
export function ArtifactPreviewModal({
  file,
  org,
  isTerminal,
  open,
  onClose,
  onApplied,
  onImplement,
  className,
}: ArtifactPreviewModalProps) {
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) onClose();
    },
    [onClose],
  );

  return (
    <DialogShell
      open={open}
      onOpenChange={handleOpenChange}
      width="3xl"
      aria-label={`Preview ${file.spec?.filename ?? ""}`}
      // Background surface is deliberate for content previews. The
      // previously hardcoded ::backdrop color (bg-black/50 — it escaped the
      // #652 fence via the arbitrary-variant spelling) now rides the
      // shell's token backdrop.
      className={cn("stg:bg-background stg:text-foreground stg:outline-none", className)}
    >
      {open && (
        <ArtifactPreviewContent
          file={file}
          org={org}
          isTerminal={isTerminal}
          onClose={onClose}
          onApplied={onApplied}
          onImplement={onImplement}
        />
      )}
    </DialogShell>
  );
}

// ---------------------------------------------------------------------------
// Shared style constants
// ---------------------------------------------------------------------------

const FOCUS_RING_CLASSES =
  "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring stg:focus-visible:rounded-sm";

// ---------------------------------------------------------------------------
// ContentHeader (internal)
// ---------------------------------------------------------------------------

function ContentHeader({
  file,
  detectionLabel,
  isDetecting,
  onClose,
}: {
  readonly file: StigmerFile;
  readonly detectionLabel: string | null;
  readonly isDetecting: boolean;
  readonly onClose: () => void;
}) {
  return (
    <div className="stg:flex stg:items-start stg:gap-3 stg:p-4 stg:pb-3">
      <span className="stg:mt-0.5 stg:shrink-0 stg:text-muted-foreground">
        <FileIcon />
      </span>

      <div className="stg:min-w-0 stg:flex-1">
        <h2 className="stg:truncate stg:text-sm stg:font-semibold stg:text-foreground">
          {file.spec?.filename ?? ""}
        </h2>
        <div className="stg:mt-0.5 stg:flex stg:flex-wrap stg:items-center stg:gap-2">
          <span className="stg:text-xs stg:tabular-nums stg:text-muted-foreground">
            {formatArtifactSize(file.status?.sizeBytes ?? 0n)}
          </span>
          {isDetecting && !detectionLabel && (
            <span
              className="stg:h-4 stg:w-24 stg:animate-pulse stg:rounded-full stg:bg-muted"
              aria-hidden="true"
            />
          )}
          {detectionLabel && (
            <span className="stg:inline-flex stg:items-center stg:rounded-full stg:bg-primary-subtle stg:px-2 stg:py-0.5 stg:text-xs stg:font-medium stg:text-primary">
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
          "stg:shrink-0 stg:rounded-sm stg:p-1 stg:text-muted-foreground stg:transition-colors stg:hover:text-foreground",
          FOCUS_RING_CLASSES,
        )}
      >
        <CloseIcon />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ActionBar (internal)
// ---------------------------------------------------------------------------

function ActionBar({
  file,
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
  onImplement,
}: {
  readonly file: StigmerFile;
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
  readonly onImplement?: () => void;
}) {
  const { download, isDownloading } = useFileDownload();
  return (
    <div className="stg:flex stg:items-center stg:justify-between stg:gap-3 stg:border-t stg:border-border stg:px-4 stg:py-3">
      <div className="stg:flex stg:items-center stg:gap-3">
        {hasContent && (
          <button
            type="button"
            onClick={onCopy}
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
          onClick={() => download(file.metadata?.id ?? "", file.spec?.filename)}
          disabled={isDownloading}
          className={cn(
            "stg:inline-flex stg:items-center stg:gap-1.5 stg:text-xs stg:font-medium stg:text-muted-foreground stg:transition-colors stg:hover:text-foreground stg:disabled:opacity-50",
            FOCUS_RING_CLASSES,
          )}
        >
          <DownloadIcon />
          {isDownloading ? "Preparing…" : "Download"}
        </button>
      </div>

      <div className="stg:flex stg:shrink-0 stg:items-center stg:gap-3">
        {onImplement && (
          <button
            type="button"
            onClick={onImplement}
            className={cn(
              "stg:inline-flex stg:items-center stg:gap-1.5 stg:rounded-md stg:px-4 stg:py-1.5 stg:text-xs stg:font-medium stg:transition-colors",
              "stg:bg-primary stg:text-primary-foreground stg:hover:bg-primary-hover",
              "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring stg:focus-visible:ring-offset-2",
            )}
          >
            <ImplementIcon />
            Build
          </button>
        )}
        {applyResult ? (
          <span className="stg:inline-flex stg:items-center stg:gap-1.5 stg:text-xs stg:font-medium stg:text-success">
            <CheckIcon />
            Applied {"\u00B7"} {applyResult.name || applyResult.kind}
          </span>
        ) : applyError ? (
          <span className="stg:inline-flex stg:items-center stg:gap-2" role="alert">
            <span className="stg:text-xs stg:text-destructive">
              {applyError.message}
            </span>
            <button
              type="button"
              onClick={onApply}
              className={cn(
                "stg:text-xs stg:font-medium stg:text-destructive stg:underline stg:transition-colors stg:hover:text-destructive-muted",
                FOCUS_RING_CLASSES,
              )}
            >
              Retry
            </button>
          </span>
        ) : isDetected && ctaLabel ? (
          <span data-cursor-target="apply-resource-button">
            <ArtifactApplyButton
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

function ImplementIcon() {
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
      <path d="M2 6h8M7 3l3 3-3 3" />
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

