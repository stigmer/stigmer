"use client";

import { cn } from "@stigmer/theme";

/** Props for {@link WizardNav}. */
export interface WizardNavProps {
  /** Whether the Back button should be displayed. */
  readonly showBack: boolean;
  /** Label for the primary action button. */
  readonly nextLabel: string;
  /** Whether the primary action is disabled. */
  readonly nextDisabled?: boolean;
  /** Whether the primary action is in a loading state. */
  readonly isSubmitting?: boolean;
  /** Called when Back is clicked. */
  readonly onBack: () => void;
  /** Called when Next/Submit is clicked. */
  readonly onNext: () => void;
  /** Called when Cancel is clicked. */
  readonly onCancel?: () => void;
  /** Additional CSS classes for the root container. */
  readonly className?: string;
}

/**
 * Navigation footer for the wizard shell.
 *
 * Renders Back / Next|Submit buttons in a standardized layout.
 * The primary (right-side) button adapts its label and loading
 * state based on whether it's the final step.
 *
 * Keyboard: Enter triggers the primary action when focused within
 * the wizard content (not within text areas or other multi-line inputs).
 */
export function WizardNav({
  showBack,
  nextLabel,
  nextDisabled,
  isSubmitting,
  onBack,
  onNext,
  onCancel,
  className,
}: WizardNavProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-between border-t border-border px-6 py-4",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm",
              "text-muted-foreground transition-colors",
              "hover:text-foreground hover:bg-accent-hover",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "disabled:pointer-events-none disabled:opacity-50",
            )}
          >
            Cancel
          </button>
        )}
      </div>

      <div className="flex items-center gap-2">
        {showBack && (
          <button
            type="button"
            onClick={onBack}
            disabled={isSubmitting}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium text-foreground transition-colors",
              "hover:bg-accent-hover",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "disabled:pointer-events-none disabled:opacity-50",
            )}
          >
            <ArrowLeftIcon className="size-3.5" />
            Back
          </button>
        )}

        <button
          type="button"
          onClick={onNext}
          disabled={nextDisabled || isSubmitting}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground transition-colors",
            "hover:bg-primary-hover",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "disabled:pointer-events-none disabled:opacity-40",
          )}
        >
          {isSubmitting && <SpinnerIcon />}
          {nextLabel}
          {!isSubmitting && <ArrowRightIcon className="size-3.5" />}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function ArrowLeftIcon({ className }: { readonly className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10 3 5 8l5 5" />
    </svg>
  );
}

function ArrowRightIcon({ className }: { readonly className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m6 3 5 5-5 5" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className="animate-spin"
      aria-hidden="true"
    >
      <path d="M8 2a6 6 0 1 0 6 6" />
    </svg>
  );
}
