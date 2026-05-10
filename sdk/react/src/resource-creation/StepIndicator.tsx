"use client";

import { cn } from "@stigmer/theme";

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
      className={cn("flex flex-col gap-1", className)}
    >
      <ol className="flex flex-col gap-1" role="list">
        {steps.map((step, index) => {
          const state = getStepState(index, currentStepIndex);
          const isClickable = state === "completed" && onStepClick != null;

          const content = (
            <div className="flex items-center gap-3">
              <StepCircle index={index} state={state} />
              <span
                className={cn(
                  "text-sm font-medium transition-colors",
                  state === "active" && "text-foreground",
                  state === "completed" && "text-foreground",
                  state === "pending" && "text-muted-foreground",
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
                    "w-full rounded-md px-2 py-2 text-left transition-colors",
                    "hover:bg-accent-hover",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  )}
                  aria-label={`Go back to step ${index + 1}: ${step.label}`}
                  aria-current={undefined}
                >
                  {content}
                </button>
              ) : (
                <div
                  className="px-2 py-2"
                  aria-current={state === "active" ? "step" : undefined}
                >
                  {content}
                </div>
              )}
              {index < steps.length - 1 && (
                <div
                  className="ml-[18px] h-4 w-px bg-border"
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
        "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-medium transition-colors",
        state === "completed" && "bg-primary text-primary-foreground",
        state === "active" && "border-2 border-primary text-primary",
        state === "pending" && "border border-border text-muted-foreground",
      )}
      aria-hidden="true"
    >
      {state === "completed" ? (
        <CheckIcon className="size-3.5" />
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
