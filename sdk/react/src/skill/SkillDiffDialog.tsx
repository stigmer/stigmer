"use client";

import { useCallback, useEffect, useRef } from "react";
import { cn } from "@stigmer/theme";
import { useSkillDiff } from "./useSkillDiff.js";
import { MultiFileDiffView } from "../version-history/MultiFileDiffView.js";
import { ErrorMessage } from "../error/ErrorMessage.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** State passed to {@link SkillDiffDialog} to control its visibility. */
export interface SkillDiffDialogState {
  /** Artifact storage key for the "before" version. */
  readonly fromArtifactKey: string;
  /** Artifact storage key for the "after" version. */
  readonly toArtifactKey: string;
  /** Truncated hash label for the "before" version (display only). */
  readonly fromLabel: string;
  /** Truncated hash label for the "after" version (display only). */
  readonly toLabel: string;
}

/** Props for {@link SkillDiffDialog}. */
export interface SkillDiffDialogProps {
  /**
   * Dialog state. When non-null, the dialog opens and fetches the diff.
   * When `null`, the dialog is closed.
   */
  readonly state: SkillDiffDialogState | null;
  /** Called when the dialog is dismissed (Escape, backdrop click, close button). */
  readonly onClose: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Dialog that renders a multi-file diff between two skill versions.
 *
 * Uses native `<dialog>` with `showModal()` for built-in focus trapping,
 * Escape handling, and backdrop — consistent with `ConfirmDialog`.
 *
 * Internally composes `useSkillDiff` (data fetching) and
 * `MultiFileDiffView` (rendering). Handles loading, error, and
 * empty states.
 *
 * Zero Console dependencies — safe for platform builder embedding.
 *
 * @example
 * ```tsx
 * const [diffState, setDiffState] = useState<SkillDiffDialogState | null>(null);
 *
 * <SkillDiffDialog state={diffState} onClose={() => setDiffState(null)} />
 * ```
 */
export function SkillDiffDialog({ state, onClose }: SkillDiffDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (state && !dialog.open) {
      dialog.showModal();
    } else if (!state && dialog.open) {
      dialog.close();
    }
  }, [state]);

  const handleDialogCancel = useCallback(
    (e: React.SyntheticEvent) => {
      e.preventDefault();
      onClose();
    },
    [onClose],
  );

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDialogElement>) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose],
  );

  const { diff, isLoading, error } = useSkillDiff(
    state?.fromArtifactKey ?? null,
    state?.toArtifactKey ?? null,
  );

  if (!state) return null;

  return (
    <dialog
      ref={dialogRef}
      onCancel={handleDialogCancel}
      onClick={handleBackdropClick}
      className={cn(
        "fixed inset-0 z-50 m-auto h-[85vh] w-full max-w-4xl rounded-lg border border-border bg-popover p-0 text-popover-foreground shadow-lg",
        "backdrop:bg-black/50",
        "open:animate-in open:fade-in-0 open:zoom-in-95",
      )}
    >
      <div className="flex h-full flex-col">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium text-foreground">Comparing</span>
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
              {state.fromLabel}
            </code>
            <ArrowIcon className="size-3.5 text-muted-foreground-faint" />
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
              {state.toLabel}
            </code>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close diff viewer"
            className={cn(
              "rounded-md p-1.5 text-muted-foreground transition-colors",
              "hover:bg-accent-hover hover:text-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            <CloseIcon className="size-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-4">
          {isLoading ? (
            <DiffSkeleton />
          ) : error ? (
            <ErrorMessage error={error} />
          ) : diff ? (
            <MultiFileDiffView diff={diff} />
          ) : null}
        </div>
      </div>
    </dialog>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function DiffSkeleton() {
  return (
    <div
      className="flex flex-col gap-4"
      aria-busy="true"
      aria-label="Loading diff"
    >
      <div className="flex items-center gap-2">
        <div className="h-4 w-36 animate-pulse rounded bg-muted" />
        <div className="h-4 w-20 animate-pulse rounded bg-muted" />
        <div className="h-4 w-20 animate-pulse rounded bg-muted" />
      </div>
      <div className="h-6 w-full animate-pulse rounded bg-muted" />
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <div key={i} className="flex gap-2">
          <div className="h-4 w-10 animate-pulse rounded bg-muted" />
          <div className="h-4 w-10 animate-pulse rounded bg-muted" />
          <div className="h-4 flex-1 animate-pulse rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function ArrowIcon({ className }: { readonly className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 8h10M9 4l4 4-4 4" />
    </svg>
  );
}

function CloseIcon({ className }: { readonly className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}
