"use client";

import { cn } from "@stigmer/theme";
import { Tooltip, TooltipContent, TooltipTrigger } from "../internal/tooltip.js";

/** Props for {@link FileReferenceChipList}. */
export interface FileReferenceChipListProps {
  /** Workspace-relative file paths to display as reference chips. */
  readonly refs: readonly string[];
  /** Called when the user removes a file reference. */
  readonly onRemove: (path: string) => void;
  /** Disables the remove action on all chips. */
  readonly disabled?: boolean;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Renders a horizontal list of workspace file-reference chips.
 *
 * Each chip shows the workspace-relative path (truncated) with a remove
 * button. Unlike attachment chips, file references have no upload
 * lifecycle — they are instant, lightweight "attention" signals.
 *
 * Designed to sit alongside {@link AttachmentChipList} in the composer's
 * attachments zone. Usable standalone by platform builders who compose
 * their own file-reference UI (headless-first, DD-003).
 *
 * All visual properties flow through `--stgm-*` tokens (DD-005).
 *
 * @example
 * ```tsx
 * function CustomComposer() {
 *   const fileRefs = useFileReferences();
 *
 *   return (
 *     <FileReferenceChipList
 *       refs={fileRefs.refs}
 *       onRemove={fileRefs.remove}
 *     />
 *   );
 * }
 * ```
 */
export function FileReferenceChipList({
  refs,
  onRemove,
  disabled,
  className,
}: FileReferenceChipListProps) {
  if (refs.length === 0) return null;

  return (
    <div
      className={cn("stg:flex stg:flex-wrap stg:gap-1.5", className)}
      role="list"
      aria-label="Referenced workspace files"
    >
      {refs.map((path) => (
        <FileReferenceChip
          key={path}
          path={path}
          onRemove={() => onRemove(path)}
          disabled={disabled}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Individual chip
// ---------------------------------------------------------------------------

function FileReferenceChip({
  path,
  onRemove,
  disabled,
}: {
  readonly path: string;
  readonly onRemove: () => void;
  readonly disabled?: boolean;
}) {
  const filename = path.split("/").pop() ?? path;

  return (
    // The chip shows only the basename; the tooltip restores the full path,
    // so it is a hover-always hint on the chip, not an overflow-gated
    // TruncatedText.
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            role="listitem"
            aria-label={`Referenced file: ${path}`}
            className="stg:inline-flex stg:max-w-[200px] stg:items-center stg:gap-1 stg:rounded-md stg:bg-muted-subtle stg:px-2 stg:py-0.5 stg:text-xs stg:text-foreground"
          />
        }
      >
        <FileRefIcon />
        <span className="stg:truncate">{filename}</span>
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          className="stg:ml-0.5 stg:shrink-0 stg:text-muted-foreground stg:hover:text-destructive stg:disabled:pointer-events-none"
          aria-label={`Remove reference to ${path}`}
        >
          <XIcon />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="stg:break-all">
        {path}
      </TooltipContent>
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------
// Inline SVG icons
// ---------------------------------------------------------------------------

function FileRefIcon() {
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
      className="stg:shrink-0 stg:text-accent-foreground"
      aria-hidden="true"
    >
      <path d="M8 1H4C3.45 1 3 1.45 3 2V12C3 12.55 3.45 13 4 13H10C10.55 13 11 12.55 11 12V4L8 1Z" />
      <path d="M8 1V4H11" />
      <path d="M5 8H9M5 10H8" />
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
