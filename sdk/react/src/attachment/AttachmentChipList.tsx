"use client";

import { cn } from "@stigmer/theme";
import type { AttachmentEntry } from "./useAttachments";
import { formatFileSize } from "./attachment-utils";

/** Props for {@link AttachmentChipList}. */
export interface AttachmentChipListProps {
  /** Attachment entries from {@link useAttachments}. */
  readonly entries: readonly AttachmentEntry[];
  /** Remove callback (by entry ID). */
  readonly onRemove: (id: string) => void;
  /** Retry callback for failed uploads (by entry ID). */
  readonly onRetry: (id: string) => void;
  /** Disables remove and retry actions. */
  readonly disabled?: boolean;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Renders a horizontal list of compact attachment chips showing
 * filename, size, upload status, and remove/retry actions.
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
  disabled,
  className,
}: AttachmentChipListProps) {
  if (entries.length === 0) return null;

  return (
    <div
      className={cn("flex flex-wrap gap-1.5", className)}
      role="list"
      aria-label="Attached files"
    >
      {entries.map((entry) => (
        <AttachmentChip
          key={entry.id}
          entry={entry}
          onRemove={() => onRemove(entry.id)}
          onRetry={() => onRetry(entry.id)}
          disabled={disabled}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Individual chip
// ---------------------------------------------------------------------------

function AttachmentChip({
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
      aria-label={`${entry.file.name}, ${formatFileSize(entry.file.size)}${isUploading ? ", uploading" : ""}${isError ? ", upload failed" : ""}`}
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

      {isError && (
        <button
          type="button"
          onClick={onRetry}
          disabled={disabled}
          className="shrink-0 text-[0.6rem] font-medium text-destructive underline hover:text-destructive-muted disabled:pointer-events-none"
          aria-label={`Retry uploading ${entry.file.name}`}
        >
          Retry
        </button>
      )}

      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        className="ml-0.5 shrink-0 text-muted-foreground hover:text-destructive disabled:pointer-events-none"
        aria-label={`Remove ${entry.file.name}`}
      >
        <XIcon />
      </button>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Inline SVG icons — kept minimal and consistent with SessionComposer icons
// ---------------------------------------------------------------------------

function ChipSpinner() {
  return (
    <svg
      width="10"
      height="10"
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
