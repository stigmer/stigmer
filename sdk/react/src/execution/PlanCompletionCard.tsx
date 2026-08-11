"use client";

import { memo } from "react";
import { cn } from "@stigmer/theme";
import { useBuildFromPlanHotkey } from "./use-build-from-plan-hotkey.js";

/** Props for {@link PlanCompletionCard}. */
export interface PlanCompletionCardProps {
  /** Called when the user clicks the "Build" button. */
  readonly onImplement?: () => void;
  /** Disables the CTA button (e.g., while an execution is active). */
  readonly disabled?: boolean;
  /** Additional CSS classes for the root element. */
  readonly className?: string;
}

/**
 * Fallback CTA shown in the {@link MessageThread} after a completed Plan-mode
 * execution that did **not** publish a `plan.md` artifact (older executions, or
 * a plan whose upload failed). When a plan artifact exists, the richer
 * `PlanArtifactCard` is shown instead.
 *
 * Mirrors `PlanArtifactCard`'s hierarchy — one prominent, themeable "Build"
 * primary action with the same card-scoped `Cmd/Ctrl+Enter` accelerator — so
 * the two cards feel like the same affordance. The consumer wires the action
 * to switch the interaction mode to Agent and submit the implement turn.
 *
 * Renders nothing when `onImplement` is not provided, so the card is fully
 * opt-in from the consumer's perspective. All visual properties flow through
 * `--stgm-*` tokens.
 */
export const PlanCompletionCard = memo(function PlanCompletionCard({
  onImplement,
  disabled,
  className,
}: PlanCompletionCardProps) {
  const handleKeyDown = useBuildFromPlanHotkey(onImplement, disabled);

  if (!onImplement) return null;

  return (
    <div
      role="status"
      aria-label="Plan complete"
      onKeyDown={handleKeyDown}
      className={cn(
        "stg:mx-4 stg:flex stg:items-center stg:gap-3 stg:rounded-md stg:border stg:border-border-muted",
        "stg:bg-muted-faint stg:px-3 stg:py-2.5",
        className,
      )}
    >
      <PlanCompleteIcon />
      <span className="stg:min-w-0 stg:flex-1 stg:text-xs stg:font-medium stg:text-muted-foreground">
        Plan complete — ready to build?
      </span>
      <button
        type="button"
        disabled={disabled}
        onClick={onImplement}
        className={cn(
          "stg:inline-flex stg:items-center stg:gap-1.5 stg:rounded-md stg:px-3 stg:py-1.5",
          "stg:text-xs stg:font-medium stg:transition-colors",
          "stg:bg-primary stg:text-primary-foreground",
          "stg:hover:bg-primary-hover",
          "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
          "stg:disabled:pointer-events-none stg:disabled:opacity-50",
        )}
      >
        <ImplementIcon />
        Build
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
      className="stg:shrink-0 stg:text-muted-foreground/70"
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
