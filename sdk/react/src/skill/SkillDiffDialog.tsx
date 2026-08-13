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
        "stg:fixed stg:inset-0 stg:z-50 stg:m-auto stg:h-[85vh] stg:w-full stg:max-w-4xl stg:rounded-lg stg:border stg:border-border stg:bg-popover stg:p-0 stg:text-popover-foreground stg:shadow-lg",
        "stg:backdrop:bg-backdrop",
        "stg:open:animate-in stg:open:fade-in-0 stg:open:zoom-in-95",
      )}
    >
      <div className="stg:flex stg:h-full stg:flex-col">
        {/* Header */}
        <div className="stg:flex stg:shrink-0 stg:items-center stg:justify-between stg:border-b stg:border-border stg:px-4 stg:py-3">
          <div className="stg:flex stg:items-center stg:gap-2 stg:text-sm">
            <span className="stg:font-medium stg:text-foreground">Comparing</span>
            <code className="stg:rounded stg:bg-muted stg:px-1.5 stg:py-0.5 stg:font-mono stg:text-[11px] stg:text-muted-foreground">
              {state.fromLabel}
            </code>
            <ArrowIcon className="stg:size-3.5 stg:text-muted-foreground-faint" />
            <code className="stg:rounded stg:bg-muted stg:px-1.5 stg:py-0.5 stg:font-mono stg:text-[11px] stg:text-muted-foreground">
              {state.toLabel}
            </code>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close diff viewer"
            className={cn(
              "stg:rounded-md stg:p-1.5 stg:text-muted-foreground stg:transition-colors",
              "stg:hover:bg-accent-hover stg:hover:text-foreground",
              "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
            )}
          >
            <CloseIcon className="stg:size-4" />
          </button>
        </div>

        {/* Body */}
        <div className="stg:flex-1 stg:overflow-auto stg:p-4">
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
      className="stg:flex stg:flex-col stg:gap-4"
      aria-busy="true"
      aria-label="Loading diff"
    >
      <div className="stg:flex stg:items-center stg:gap-2">
        <div className="stg:h-4 stg:w-36 stg:animate-pulse stg:rounded stg:bg-muted" />
        <div className="stg:h-4 stg:w-20 stg:animate-pulse stg:rounded stg:bg-muted" />
        <div className="stg:h-4 stg:w-20 stg:animate-pulse stg:rounded stg:bg-muted" />
      </div>
      <div className="stg:h-6 stg:w-full stg:animate-pulse stg:rounded stg:bg-muted" />
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <div key={i} className="stg:flex stg:gap-2">
          <div className="stg:h-4 stg:w-10 stg:animate-pulse stg:rounded stg:bg-muted" />
          <div className="stg:h-4 stg:w-10 stg:animate-pulse stg:rounded stg:bg-muted" />
          <div className="stg:h-4 stg:flex-1 stg:animate-pulse stg:rounded stg:bg-muted" />
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
