"use client";

import { memo } from "react";
import { cn } from "@stigmer/theme";

/** Props for {@link PlanCompletionCard}. */
export interface PlanCompletionCardProps {
  /** Called when the user clicks the "Implement" button. */
  readonly onImplement?: () => void;
  /** Disables the CTA button (e.g., while an execution is active). */
  readonly disabled?: boolean;
  /** Additional CSS classes for the root element. */
  readonly className?: string;
}

/**
 * Inline CTA card shown in the {@link MessageThread} after a completed
 * Plan-mode execution.
 *
 * Offers a single "Implement" action that the consumer wires to switch
 * the interaction mode to Agent, pre-fill the composer, and focus it.
 *
 * Renders nothing when `onImplement` is not provided, so the card is
 * fully opt-in from the consumer's perspective.
 *
 * All visual properties flow through `--stgm-*` tokens.
 */
export const PlanCompletionCard = memo(function PlanCompletionCard({
  onImplement,
  disabled,
  className,
}: PlanCompletionCardProps) {
  if (!onImplement) return null;

  return (
    <div
      role="status"
      aria-label="Plan complete"
      className={cn(
        "mx-4 flex items-center gap-3 rounded-md border border-border/50",
        "bg-muted/30 px-3 py-2.5",
        className,
      )}
    >
      <PlanCompleteIcon />
      <span className="min-w-0 flex-1 text-xs font-medium text-muted-foreground">
        Plan complete — ready to implement?
      </span>
      <button
        type="button"
        disabled={disabled}
        onClick={onImplement}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5",
          "text-xs font-medium transition-colors",
          "bg-primary text-primary-foreground",
          "hover:bg-primary-hover",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          "disabled:pointer-events-none disabled:opacity-50",
        )}
      >
        <ImplementIcon />
        Implement
      </button>
    </div>
  );
});

function PlanCompleteIcon() {
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
      className="shrink-0 text-muted-foreground/70"
      aria-hidden="true"
    >
      <path d="M3 4h10M3 8h7M3 12h8" />
      <path d="M12.5 10.5l1.5 1.5-1.5 1.5" />
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
      aria-hidden="true"
    >
      <path d="M2 6h8M7 3l3 3-3 3" />
    </svg>
  );
}
