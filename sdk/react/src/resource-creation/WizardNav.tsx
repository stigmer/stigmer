"use client";

import { cn } from "@stigmer/theme";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";

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
        "stg:flex stg:items-center stg:justify-between stg:border-t stg:border-border stg:px-6 stg:py-4",
        className,
      )}
    >
      <div className="stg:flex stg:items-center stg:gap-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            className={cn(
              "stg:rounded-md stg:px-3 stg:py-1.5 stg:text-sm",
              "stg:text-muted-foreground stg:transition-colors",
              "stg:hover:text-foreground stg:hover:bg-accent-hover",
              "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
              "stg:disabled:pointer-events-none stg:disabled:opacity-50",
            )}
          >
            Cancel
          </button>
        )}
      </div>

      <div className="stg:flex stg:items-center stg:gap-2">
        {showBack && (
          <button
            type="button"
            onClick={onBack}
            disabled={isSubmitting}
            className={cn(
              "stg:inline-flex stg:items-center stg:gap-1.5 stg:rounded-md stg:border stg:border-input stg:bg-background stg:px-3 stg:py-1.5 stg:text-sm stg:font-medium stg:text-foreground stg:transition-colors",
              "stg:hover:bg-accent-hover",
              "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
              "stg:disabled:pointer-events-none stg:disabled:opacity-50",
            )}
          >
            <ArrowLeftIcon className="stg:size-3.5" />
            Back
          </button>
        )}

        <button
          type="button"
          onClick={onNext}
          disabled={nextDisabled || isSubmitting}
          data-cursor-target="wizard-next"
          className={cn(
            "stg:inline-flex stg:items-center stg:gap-1.5 stg:rounded-md stg:bg-primary stg:px-4 stg:py-1.5 stg:text-sm stg:font-medium stg:text-primary-foreground stg:transition-colors",
            "stg:hover:bg-primary-hover",
            "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
            "stg:disabled:pointer-events-none stg:disabled:opacity-40",
          )}
        >
          {isSubmitting && <SpinnerIcon size={14} />}
          {nextLabel}
          {!isSubmitting && <ArrowRightIcon className="stg:size-3.5" />}
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

