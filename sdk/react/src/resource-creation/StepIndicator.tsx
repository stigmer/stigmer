"use client";

import { cn } from "@stigmer/theme";
import { UNSTYLED_LIST } from "../internal/element-resets.js";

/** Props for {@link StepIndicator}. */
export interface StepIndicatorProps {
  /** Step definitions to render (only `id` and `label` are used for rendering). */
  readonly steps: readonly { readonly id: string; readonly label: string }[];
  /** Zero-based index of the currently active step. */
  readonly currentStepIndex: number;
  /** Called when a completed step is clicked (backward navigation). */
  readonly onStepClick?: (index: number) => void;
  /** Additional CSS classes for the root container. */
  readonly className?: string;
}

/**
 * Vertical step progress indicator for multi-step wizards.
 *
 * Renders each step as a numbered circle with label. Steps are
 * color-coded by state: completed (filled), active (ring), pending
 * (muted). Completed steps are clickable for backward navigation.
 *
 * Responsive: collapses to a compact horizontal layout on narrow
 * viewports via CSS container queries.
 *
 * Uses `--stgm-*` tokens exclusively. Zero Console dependencies.
 */
export function StepIndicator({
  steps,
  currentStepIndex,
  onStepClick,
  className,
}: StepIndicatorProps) {
  return (
    <nav
      aria-label="Wizard progress"
      className={cn("stg:flex stg:flex-col stg:gap-1", className)}
    >
      <ol className={cn(UNSTYLED_LIST, "stg:flex stg:flex-col stg:gap-1")} role="list">
        {steps.map((step, index) => {
          const state = getStepState(index, currentStepIndex);
          const isClickable = state === "completed" && onStepClick != null;

          const content = (
            <div className="stg:flex stg:items-center stg:gap-3">
              <StepCircle index={index} state={state} />
              <span
                className={cn(
                  "stg:text-sm stg:font-medium stg:transition-colors",
                  state === "active" && "stg:text-foreground",
                  state === "completed" && "stg:text-foreground",
                  state === "pending" && "stg:text-muted-foreground",
                )}
              >
                {step.label}
              </span>
            </div>
          );

          return (
            <li key={step.id}>
              {isClickable ? (
                <button
                  type="button"
                  onClick={() => onStepClick(index)}
                  className={cn(
                    "stg:w-full stg:rounded-md stg:px-2 stg:py-2 stg:text-left stg:transition-colors",
                    "stg:hover:bg-accent-hover",
                    "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-inset stg:focus-visible:ring-ring",
                  )}
                  aria-label={`Go back to step ${index + 1}: ${step.label}`}
                  aria-current={undefined}
                >
                  {content}
                </button>
              ) : (
                <div
                  className="stg:px-2 stg:py-2"
                  aria-current={state === "active" ? "step" : undefined}
                >
                  {content}
                </div>
              )}
              {index < steps.length - 1 && (
                <div
                  className="stg:ml-[18px] stg:h-4 stg:w-px stg:bg-border"
                  aria-hidden="true"
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Step circle — the numbered indicator
// ---------------------------------------------------------------------------

type StepState = "completed" | "active" | "pending";

function getStepState(index: number, currentIndex: number): StepState {
  if (index < currentIndex) return "completed";
  if (index === currentIndex) return "active";
  return "pending";
}

function StepCircle({
  index,
  state,
}: {
  readonly index: number;
  readonly state: StepState;
}) {
  return (
    <div
      className={cn(
        "stg:flex stg:size-7 stg:shrink-0 stg:items-center stg:justify-center stg:rounded-full stg:text-xs stg:font-medium stg:transition-colors",
        state === "completed" && "stg:bg-primary stg:text-primary-foreground",
        state === "active" && "stg:border-2 stg:border-primary stg:text-primary",
        state === "pending" && "stg:border stg:border-border stg:text-muted-foreground",
      )}
      aria-hidden="true"
    >
      {state === "completed" ? (
        <CheckIcon className="stg:size-3.5" />
      ) : (
        <span>{index + 1}</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function CheckIcon({ className }: { readonly className?: string }) {
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
      <path d="m3 8.5 3.5 3.5 6.5-8" />
    </svg>
  );
}
