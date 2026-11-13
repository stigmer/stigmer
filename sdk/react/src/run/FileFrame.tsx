"use client";

/**
 * One File's frame, drawn once for its two homes: the preview window
 * (`FilePreviewContent` inside `FilePreviewModal`, and the Library's
 * preview through it) and the session panel's file tab (`FileDocument`).
 * Internal: the package exports those two, never this.
 *
 * The header says what the File is: a 32px muted square with the file
 * glyph, the name (14/20 semibold) with "{kind} · {size}" under it in the
 * words the thread's Made cards use, and the detection tag beside the name
 * once the File reads as a Stigmer resource. Its acts sit at the right: at
 * most one primary (Build for a plan, or Apply for a detected manifest),
 * then Copy, Download and Add as skill as ghost buttons with their glyphs,
 * the host's access controls, and Delete last in the destructive colour.
 * The window adds Close at the far right. Under the header, the shared
 * {@link FileBody} (with its Rendered / Source switch).
 *
 * Trade-offs:
 * - Every act's gate stays where it was: Apply waits for the run to end,
 *   a read-only reader (a chat link's guest) gets no Apply, no Add as skill
 *   and no Delete, and Add as skill and Delete each ask the server first.
 * - Build outranks Apply. A plan is Markdown and a manifest YAML, so no
 *   File offers both; were one to, it offers Build alone, keeping the
 *   header to one primary act.
 * - Apply is drawn here at the header's primary size, with the same
 *   terminal and in-flight gating `FileApplyButton` has.
 * - The two homes differ only in how they scroll: the window's body
 *   scrolls under a fixed header, the tab's header sticks to the top of
 *   the pane that scrolls.
 */

import type { ReactNode } from "react";
import type { File as StigmerFile } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { cn } from "@stigmer/design-tokens";
import { Button } from "../button/Button.js";
import { IconButton } from "../button/IconButton.js";
import { Tag } from "../internal/surface/Tag.js";
import { SpinnerIcon } from "../internal/thread-card/glyphs.js";
import { sizeWords } from "../internal/size-words.js";
import { fileKind } from "../session/TurnOutcome.js";
import { useFileDownload } from "../file/useFile.js";
import type { ApplyResourceResult } from "../library/useApplyResource.js";
import { FileBody } from "./FileBody.js";
import { FileAddAsSkillAction, FileDeleteAction } from "./FileActions.js";
import type { FileInspection } from "./useFileInspection.js";

/** Props for {@link FileFrame}. */
export interface FileFrameProps {
  /** The File shown. */
  readonly file: StigmerFile;
  /** Its inspect-and-act pipeline (`useFileInspection`), owned by the home. */
  readonly inspection: FileInspection;
  /** Whether the run that returned the File has ended: Apply waits for it. */
  readonly isTerminal: boolean;
  /** Which home draws the frame: the preview window, or the session panel's tab. */
  readonly layout: "window" | "pane";
  /** No Apply, no Add as skill and no Delete, and no permission read for them. */
  readonly readOnly?: boolean;
  /** Build, the plan's primary act. */
  readonly onBuild?: () => void;
  /** Called after Add as skill pushes the File. */
  readonly onApplied?: (result: ApplyResourceResult) => void;
  /** Offers Delete (to a caller the server allows) and is called once the File is deleted. */
  readonly onDeleted?: () => void;
  /** Host controls for who may see the File, drawn before Delete. */
  readonly accessSlot?: ReactNode;
  /** The window's Close, at the far right of the header. */
  readonly onClose?: () => void;
  /** The root's role (the tab is an article). */
  readonly role?: string;
  /** The root's accessible name. */
  readonly "aria-label"?: string;
  /** Additional CSS classes for the root element. */
  readonly className?: string;
}

/** One File's header, acts and body (module header). */
export function FileFrame({
  file,
  inspection,
  isTerminal,
  layout,
  readOnly = false,
  onBuild,
  onApplied,
  onDeleted,
  accessSlot,
  onClose,
  role,
  "aria-label": ariaLabel,
  className,
}: FileFrameProps) {
  const name = file.spec?.filename ?? "";
  const kind = fileKind(name, file.spec?.mimeType ?? "");
  const size = sizeWords(file.status?.sizeBytes);
  const isWindow = layout === "window";

  return (
    <div
      role={role}
      aria-label={ariaLabel}
      className={cn(
        "stg:flex stg:min-w-0 stg:flex-col",
        isWindow ? "stg:max-h-[80vh]" : "stg:min-h-0 stg:flex-1",
        className,
      )}
    >
      <div
        data-file-frame-header=""
        className={cn(
          "stg:flex stg:min-w-0 stg:items-start stg:gap-3 stg:border-b stg:border-border stg:bg-background stg:px-4 stg:py-3",
          !isWindow && "stg:sticky stg:top-0 stg:z-10",
        )}
      >
        <div className="stg:flex stg:min-w-0 stg:flex-1 stg:flex-wrap stg:items-center stg:gap-x-3 stg:gap-y-2">
          <div className="stg:flex stg:min-w-0 stg:flex-1 stg:basis-60 stg:items-center stg:gap-3">
            <span
              className="stg:grid stg:size-8 stg:shrink-0 stg:place-items-center stg:rounded-md stg:bg-muted stg:text-muted-foreground"
              aria-hidden="true"
            >
              <FileIcon />
            </span>
            <div className="stg:min-w-0 stg:flex-1">
              <div className="stg:flex stg:min-w-0 stg:items-center stg:gap-2">
                <h2 className="stg:m-0 stg:truncate stg:text-sm stg:font-semibold stg:text-foreground">{name}</h2>
                {inspection.isDetecting && !inspection.detectionLabel && (
                  <span
                    className="stg:h-4 stg:w-24 stg:shrink-0 stg:animate-pulse stg:rounded-full stg:bg-muted"
                    aria-hidden="true"
                  />
                )}
                {inspection.detectionLabel && <Tag className="stg:shrink-0">{inspection.detectionLabel}</Tag>}
              </div>
              <p className="stg:m-0 stg:truncate stg:text-xs stg:tabular-nums stg:text-muted-foreground">
                {size === "" ? kind : `${kind} · ${size}`}
              </p>
            </div>
          </div>

          <FileActs
            file={file}
            inspection={inspection}
            isTerminal={isTerminal}
            readOnly={readOnly}
            onBuild={onBuild}
            onApplied={onApplied}
            onDeleted={onDeleted}
            accessSlot={accessSlot}
          />
        </div>

        {onClose && <IconButton label="Close preview" icon={<CloseIcon />} onClick={onClose} />}
      </div>

      <FileBody
        file={file}
        content={inspection.content}
        contentType={inspection.contentType}
        isLoading={inspection.isLoading}
        error={inspection.error}
        isTruncated={inspection.isTruncated}
        onRetry={inspection.refetch}
        className={isWindow ? "stg:min-h-0 stg:flex-1 stg:overflow-y-auto" : "stg:min-w-0"}
      />

      <div role="status" aria-live="polite" aria-atomic="true" className="stg:sr-only">
        {inspection.copied && "Content copied to clipboard"}
      </div>
    </div>
  );
}

/** The header's acts, in order: the one primary, Copy, Download, Add as skill, the access controls, Delete. */
function FileActs({
  file,
  inspection,
  isTerminal,
  readOnly,
  onBuild,
  onApplied,
  onDeleted,
  accessSlot,
}: {
  readonly file: StigmerFile;
  readonly inspection: FileInspection;
  readonly isTerminal: boolean;
  readonly readOnly: boolean;
  readonly onBuild?: () => void;
  readonly onApplied?: (result: ApplyResourceResult) => void;
  readonly onDeleted?: () => void;
  readonly accessSlot?: ReactNode;
}) {
  const { download, isDownloading } = useFileDownload();
  const name = file.spec?.filename ?? "";
  return (
    <div data-file-frame-acts="" className="stg:ml-auto stg:flex stg:min-w-0 stg:flex-wrap stg:items-center stg:justify-end stg:gap-2">
      {onBuild ? (
        <Button size="sm" onClick={onBuild} icon={<BuildIcon />}>
          Build
        </Button>
      ) : (
        !readOnly && <ApplyAct inspection={inspection} isTerminal={isTerminal} />
      )}
      {inspection.content !== null && (
        <Button
          variant="ghost"
          size="xs"
          onClick={inspection.copy}
          aria-label={inspection.copied ? "Copied to clipboard" : "Copy content"}
          icon={inspection.copied ? <CheckIcon /> : <CopyIcon />}
          className={inspection.copied ? "stg:text-status-ready" : undefined}
        >
          {inspection.copied ? "Copied" : "Copy"}
        </Button>
      )}
      <Button
        variant="ghost"
        size="xs"
        onClick={() => download(file.metadata?.id ?? "", name)}
        disabled={isDownloading}
        icon={<DownloadIcon />}
      >
        {isDownloading ? "Preparing…" : "Download"}
      </Button>
      {!readOnly && <FileAddAsSkillAction file={file} onAdded={onApplied} />}
      {accessSlot}
      {!readOnly && onDeleted && (
        // Delete last, in the destructive colour (FileDeleteAction draws it so).
        <FileDeleteAction file={file} onDeleted={onDeleted} />
      )}
    </div>
  );
}

/**
 * Apply, for a detected manifest: enabled once the run has ended and while
 * no apply is in flight, then "Applied · name", or the refusal with Retry.
 */
function ApplyAct({ inspection, isTerminal }: { readonly inspection: FileInspection; readonly isTerminal: boolean }) {
  const { applyResult, applyError, isApplying, isDetected, ctaLabel, apply } = inspection;
  if (applyResult) {
    return (
      <span className="stg:inline-flex stg:items-center stg:gap-1.5 stg:text-xs stg:font-medium stg:text-status-ready">
        <CheckIcon />
        Applied {"·"} {applyResult.name || applyResult.kind}
      </span>
    );
  }
  if (applyError) {
    return (
      <span className="stg:inline-flex stg:items-center stg:gap-2" role="alert">
        <span className="stg:text-xs stg:text-destructive">{applyError.message}</span>
        <Button
          variant="ghost"
          size="xs"
          onClick={() => void apply()}
          className="stg:text-destructive stg:hover:bg-destructive-subtle"
        >
          Retry
        </Button>
      </span>
    );
  }
  if (!isDetected || !ctaLabel) return null;
  const canApply = isTerminal && !isApplying;
  return (
    <span data-cursor-target="apply-resource-button">
      <Button
        size="sm"
        onClick={canApply ? () => void apply() : undefined}
        disabled={!canApply}
        aria-busy={isApplying}
        icon={isApplying ? <SpinnerIcon size={12} className="stg:shrink-0" /> : undefined}
      >
        {isApplying ? <>Applying{"…"}</> : ctaLabel}
      </Button>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Inline SVG icons (SDK independence: no icon dependency)
// ---------------------------------------------------------------------------

function FileIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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

function CopyIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" className="stg:shrink-0" aria-hidden="true">
      <rect x="4" y="4" width="6.5" height="6.5" rx="1" />
      <path d="M8 4V2.5C8 1.95 7.55 1.5 7 1.5H2.5C1.95 1.5 1.5 1.95 1.5 2.5V7C1.5 7.55 1.95 8 2.5 8H4" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="stg:shrink-0" aria-hidden="true">
      <path d="M6 1.5V8.5" />
      <path d="M3 6L6 9L9 6" />
      <path d="M2 10.5H10" />
    </svg>
  );
}

function BuildIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="stg:shrink-0" aria-hidden="true">
      <path d="M2 6h8M7 3l3 3-3 3" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="stg:shrink-0" aria-hidden="true">
      <path d="M2 6.5L4.5 9L10 3" />
    </svg>
  );
}
