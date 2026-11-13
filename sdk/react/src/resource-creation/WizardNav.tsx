"use client";

import { cn } from "@stigmer/design-tokens";
import { Button } from "../button/Button.js";
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
          <Button variant="ghost" onClick={onCancel} disabled={isSubmitting}>
            Cancel
          </Button>
        )}
      </div>

      <div className="stg:flex stg:items-center stg:gap-2">
        {showBack && (
          <Button variant="outline" onClick={onBack} disabled={isSubmitting} icon={<ArrowLeftIcon className="stg:size-3.5" />}>
            Back
          </Button>
        )}

        <Button
          onClick={onNext}
          disabled={nextDisabled || isSubmitting}
          data-cursor-target="wizard-next"
          icon={isSubmitting ? <SpinnerIcon size={14} /> : undefined}
        >
          {nextLabel}
          {!isSubmitting && <ArrowRightIcon className="stg:size-3.5" />}
        </Button>
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

