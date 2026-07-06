"use client";

import { cn } from "@stigmer/theme";

/** Props for {@link ArtifactApplyButton}. */
export interface ArtifactApplyButtonProps {
  /** CTA label (`"Apply to org"` / `"Push Skill to org"`). */
  readonly label: string;
  /**
   * Whether the producing execution is terminal. The apply/push action is only
   * enabled once the execution has finished; a mid-run artifact renders the
   * button disabled (its content may still change).
   */
  readonly isTerminal: boolean;
  /** `true` while the apply/push is in-flight. */
  readonly isApplying: boolean;
  /** Perform the apply/push. */
  readonly onApply: () => void;
}

/**
 * The primary "Apply to [org]" / "Push Skill to [org]" action for a detected
 * artifact resource, shared by every artifact chrome (the preview modal's
 * action bar and the editor-area `ArtifactDocument` toolbar) so its
 * terminal-gating, in-flight, and disabled states are single-source.
 *
 * All visual properties flow through `--stgm-*` tokens (DD-005).
 */
export function ArtifactApplyButton({
  label,
  isTerminal,
  isApplying,
  onApply,
}: ArtifactApplyButtonProps) {
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
