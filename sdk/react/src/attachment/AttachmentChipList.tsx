"use client";

import { useState } from "react";
import { cn } from "@stigmer/theme";
import type { AttachmentEntry } from "./useAttachments.js";
import { formatFileSize } from "./attachment-utils.js";
import { useObjectUrl } from "./useObjectUrl.js";
import { AttachmentImageLightbox } from "./AttachmentImageLightbox.js";
import { UNSTYLED_BUTTON } from "../internal/form-primitives.js";

/** Props for {@link AttachmentChipList}. */
export interface AttachmentChipListProps {
  /** Attachment entries from {@link useAttachments}. */
  readonly entries: readonly AttachmentEntry[];
  /** Remove callback (by entry ID). */
  readonly onRemove: (id: string) => void;
  /** Retry callback for failed uploads (by entry ID). */
  readonly onRetry: (id: string) => void;
  /**
   * Called when the user clicks an image chip's preview target. When
   * provided, it **replaces** the built-in lightbox — platform builders
   * route the click to their own viewer. Omit for the default behavior:
   * a full-size image lightbox over the locally-held file bytes.
   */
  readonly onPreview?: (entry: AttachmentEntry) => void;
  /** Disables remove and retry actions. Preview stays active — it is read-only. */
  readonly disabled?: boolean;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Renders a horizontal list of attachment chips: image attachments as
 * preview-only thumbnail tiles (the image IS the chip — no filename
 * text; visible from the moment of paste, through upload, and on error
 * — stigmer/stigmer#371, #372), other files as compact filename chips.
 * Filename, size, and upload status stay available on every chip via
 * the tooltip and the accessible label; clicking an image tile opens
 * the full image.
 *
 * Designed to sit between the context chips and toolbar in
 * {@link SessionComposer}, but usable standalone by platform builders
 * who compose their own attachment UI.
 *
 * All visual properties flow through `--stgm-*` tokens.
 *
 * @example
 * ```tsx
 * function CustomComposer() {
 *   const attachments = useAttachments({ sessionId });
 *
 *   return (
 *     <AttachmentChipList
 *       entries={attachments.entries}
 *       onRemove={attachments.remove}
 *       onRetry={attachments.retry}
 *     />
 *   );
 * }
 * ```
 */
export function AttachmentChipList({
  entries,
  onRemove,
  onRetry,
  onPreview,
  disabled,
  className,
}: AttachmentChipListProps) {
  // The built-in lightbox tracks the previewed entry by ID (direct identity,
  // never object reference), and the entry itself is derived from `entries`
  // on render — so removing an attachment while its preview is open closes
  // the lightbox without any effect-based synchronization.
  const [previewId, setPreviewId] = useState<string | null>(null);
  const previewEntry =
    previewId !== null ? (entries.find((e) => e.id === previewId) ?? null) : null;

  if (entries.length === 0) return null;

  return (
    <>
      {/* items-center is load-bearing: image tiles (h-14) and file chips
          (~h-6) share this row, and flexbox's default stretch alignment
          would balloon the file chips to tile height. */}
      <div
        className={cn("flex flex-wrap items-center gap-1.5", className)}
        role="list"
        aria-label="Attached files"
      >
        {entries.map((entry) => (
          <AttachmentChip
            key={entry.id}
            entry={entry}
            onRemove={() => onRemove(entry.id)}
            onRetry={() => onRetry(entry.id)}
            onPreview={
              onPreview
                ? () => onPreview(entry)
                : () => setPreviewId(entry.id)
            }
            disabled={disabled}
          />
        ))}
      </div>
      {/* The lightbox mounts OUTSIDE the role="list" container (and outside
          any chip): a <dialog> is not valid inside the chips' <span>
          elements, and a non-listitem child inside the list would break its
          accessibility ownership. One instance serves the whole list. */}
      {previewEntry && (
        <ChipPreviewLightbox
          entry={previewEntry}
          onClose={() => setPreviewId(null)}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Individual chip — dispatches on content type
// ---------------------------------------------------------------------------

function AttachmentChip({
  entry,
  onRemove,
  onRetry,
  onPreview,
  disabled,
}: {
  readonly entry: AttachmentEntry;
  readonly onRemove: () => void;
  readonly onRetry: () => void;
  readonly onPreview: () => void;
  readonly disabled?: boolean;
}) {
  return entry.contentType.startsWith("image/") ? (
    <ImageAttachmentChip
      entry={entry}
      onRemove={onRemove}
      onRetry={onRetry}
      onPreview={onPreview}
      disabled={disabled}
    />
  ) : (
    <FileAttachmentChip
      entry={entry}
      onRemove={onRemove}
      onRetry={onRetry}
      disabled={disabled}
    />
  );
}

/** Shared accessible name: filename, size, and upload status. */
function chipAriaLabel(entry: AttachmentEntry): string {
  const isUploading = entry.phase === "uploading";
  const isError = entry.phase === "error";
  return `${entry.file.name}, ${formatFileSize(entry.file.size)}${isUploading ? ", uploading" : ""}${isError ? ", upload failed" : ""}`;
}

// ---------------------------------------------------------------------------
// Image chip — a preview-only thumbnail tile (#371, #372)
// ---------------------------------------------------------------------------

/**
 * The preview-only image tile: the thumbnail IS the chip. No filename
 * text, no size caption — the image is its own identity (the grammar
 * users know from Cursor/ChatGPT attachment tiles), while filename,
 * size, and upload status stay one hover away in the tooltip and are
 * always in the accessible label.
 *
 * The tile is alive through every upload phase (the spinner overlays
 * the image during upload, never replaces it — the bytes are local, so
 * the preview never waits on the network) and is one large click
 * target that opens the full image. Remove is an always-visible corner
 * badge — never hover-revealed, so it exists on touch devices and is
 * discoverable without a pointer.
 *
 * On upload error the tile stays loud: destructive ring, dimmed image,
 * and a centered Retry pill — failure never hides behind hover.
 *
 * If the file claims `image/*` but the browser can't decode it (corrupt,
 * zero-byte), the chip degrades to the compact file-chip treatment — a
 * generic icon and no preview affordance, never a broken-image glyph.
 */
function ImageAttachmentChip({
  entry,
  onRemove,
  onRetry,
  onPreview,
  disabled,
}: {
  readonly entry: AttachmentEntry;
  readonly onRemove: () => void;
  readonly onRetry: () => void;
  readonly onPreview: () => void;
  readonly disabled?: boolean;
}) {
  const url = useObjectUrl(entry.file);
  const [loadFailed, setLoadFailed] = useState(false);

  if (loadFailed) {
    return (
      <FileAttachmentChip
        entry={entry}
        onRemove={onRemove}
        onRetry={onRetry}
        disabled={disabled}
      />
    );
  }

  const isError = entry.phase === "error";
  const isUploading = entry.phase === "uploading";

  return (
    // The remove badge and retry pill are SIBLINGS of the preview button,
    // absolutely positioned over it — buttons cannot nest inside buttons.
    <span
      role="listitem"
      aria-label={chipAriaLabel(entry)}
      title={entry.file.name}
      className="relative inline-flex"
    >
      {/* The whole tile is the preview target. Preview stays enabled while
          `disabled` (that prop gates the mutating remove/retry actions) and
          in every phase: the object URL wraps in-memory bytes, no fetch.
          UNSTYLED_BUTTON adds the pointer cursor — the image tile carries
          no other clickability cue. */}
      <button
        type="button"
        onClick={onPreview}
        aria-label={`Preview ${entry.file.name}`}
        className={cn(
          UNSTYLED_BUTTON,
          "relative block h-14 w-14 overflow-hidden rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          isError && "ring-1 ring-destructive",
        )}
      >
        {url ? (
          <img
            src={url}
            alt=""
            aria-hidden="true"
            onError={() => setLoadFailed(true)}
            className={cn(
              "h-full w-full object-cover",
              (isUploading || isError) && "opacity-50",
            )}
          />
        ) : (
          // One-frame placeholder until the object-URL effect runs; same
          // footprint as the image, so no layout shift.
          <span
            className="block h-full w-full animate-pulse bg-muted"
            aria-hidden="true"
          />
        )}
        {isUploading && (
          <span className="absolute inset-0 flex items-center justify-center">
            <ChipSpinner size={16} />
          </span>
        )}
      </button>

      {isError && (
        <button
          type="button"
          onClick={onRetry}
          disabled={disabled}
          aria-label={`Retry uploading ${entry.file.name}`}
          className={cn(
            UNSTYLED_BUTTON,
            "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-destructive px-1.5 py-0.5 text-[0.6rem] font-medium leading-none text-destructive-foreground shadow-sm hover:bg-destructive-hover disabled:pointer-events-none",
          )}
        >
          Retry
        </button>
      )}

      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        aria-label={`Remove ${entry.file.name}`}
        className={cn(
          UNSTYLED_BUTTON,
          // The established corner-badge geometry (ContextPopover,
          // ComposerToolbar). Solid bg + border keep it legible over any
          // image without opacity-modified tokens (Dont-Do #4).
          "absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-sm hover:text-destructive disabled:pointer-events-none",
        )}
      >
        <XIcon />
      </button>
    </span>
  );
}

// ---------------------------------------------------------------------------
// File chip — the compact treatment for non-image attachments
// ---------------------------------------------------------------------------

function FileAttachmentChip({
  entry,
  onRemove,
  onRetry,
  disabled,
}: {
  readonly entry: AttachmentEntry;
  readonly onRemove: () => void;
  readonly onRetry: () => void;
  readonly disabled?: boolean;
}) {
  const isError = entry.phase === "error";
  const isUploading = entry.phase === "uploading";

  return (
    <span
      role="listitem"
      aria-label={chipAriaLabel(entry)}
      className={cn(
        "inline-flex max-w-[200px] items-center gap-1 rounded-md px-2 py-0.5 text-xs",
        isError
          ? "border border-destructive/30 bg-destructive-subtle text-destructive"
          : "bg-muted-subtle text-foreground",
        isUploading && "opacity-70",
      )}
    >
      {isUploading && <ChipSpinner />}
      {isError && <ErrorDot />}
      {!isUploading && !isError && <FileIcon />}

      <span className="truncate">{entry.file.name}</span>

      <span className="shrink-0 text-[0.6rem] tabular-nums text-muted-foreground">
        {formatFileSize(entry.file.size)}
      </span>

      {isError && <RetryButton filename={entry.file.name} onRetry={onRetry} disabled={disabled} />}
      <RemoveButton filename={entry.file.name} onRemove={onRemove} disabled={disabled} />
    </span>
  );
}

// ---------------------------------------------------------------------------
// Shared chip actions
// ---------------------------------------------------------------------------

function RetryButton({
  filename,
  onRetry,
  disabled,
}: {
  readonly filename: string;
  readonly onRetry: () => void;
  readonly disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onRetry}
      disabled={disabled}
      className={cn(
        UNSTYLED_BUTTON,
        "shrink-0 text-[0.6rem] font-medium text-destructive underline hover:text-destructive-muted disabled:pointer-events-none",
      )}
      aria-label={`Retry uploading ${filename}`}
    >
      Retry
    </button>
  );
}

function RemoveButton({
  filename,
  onRemove,
  disabled,
}: {
  readonly filename: string;
  readonly onRemove: () => void;
  readonly disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onRemove}
      disabled={disabled}
      className={cn(
        UNSTYLED_BUTTON,
        "ml-0.5 shrink-0 text-muted-foreground hover:text-destructive disabled:pointer-events-none",
      )}
      aria-label={`Remove ${filename}`}
    >
      <XIcon />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Built-in lightbox mount
// ---------------------------------------------------------------------------

/**
 * Bridges the previewed entry to the dumb {@link AttachmentImageLightbox}:
 * mounted only while a preview is open, so its object URL is created on
 * open and revoked on close (independent of the chip's own URL, whose
 * lifetime tracks the chip).
 */
function ChipPreviewLightbox({
  entry,
  onClose,
}: {
  readonly entry: AttachmentEntry;
  readonly onClose: () => void;
}) {
  const src = useObjectUrl(entry.file);

  return (
    <AttachmentImageLightbox
      src={src}
      filename={entry.file.name}
      open
      onClose={onClose}
    />
  );
}

// ---------------------------------------------------------------------------
// Inline SVG icons — kept minimal and consistent with SessionComposer icons
// ---------------------------------------------------------------------------

function ChipSpinner({ size = 10 }: { readonly size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      className="shrink-0 animate-spin text-muted-foreground"
      aria-hidden="true"
    >
      <path d="M8 2a6 6 0 1 0 6 6" />
    </svg>
  );
}

function ErrorDot() {
  return (
    <span
      className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-destructive"
      aria-hidden="true"
    />
  );
}

function FileIcon() {
  return (
    <svg
      width="10"
      height="10"
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

function XIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 4L10 10M10 4L4 10" />
    </svg>
  );
}
