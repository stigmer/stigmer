import type { ReactNode } from "react";

// ---------------------------------------------------------------------------
// Wizard step definition — describes a single step in the wizard
// ---------------------------------------------------------------------------

/**
 * Defines a wizard step's metadata and validation logic.
 *
 * Generic over `TData` — the accumulated form state type that flows
 * through all steps. Each step's `validate` function receives the full
 * accumulated state and returns an error message or `null` if valid.
 *
 * @typeParam TData - Shape of the wizard's accumulated form data.
 */
export interface WizardStepDef<TData> {
  /** Stable step identifier (used as key and for navigation). */
  readonly id: string;
  /** Human-readable step label displayed in the step indicator. */
  readonly label: string;
  /**
   * Validates the current data before allowing navigation to the next step.
   * Returns a descriptive error string if invalid, or `null` if the step
   * passes validation.
   *
   * When omitted, the step is always considered valid.
   */
  readonly validate?: (data: TData) => string | null;
}

// ---------------------------------------------------------------------------
// Wizard state — the internal state managed by useWizardState
// ---------------------------------------------------------------------------

/** Internal state shape for the wizard reducer. */
export interface WizardState<TData> {
  /** Zero-based index of the currently active step. */
  readonly currentStepIndex: number;
  /** Accumulated form data across all steps. */
  readonly data: TData;
  /** Validation error for the current step, or `null` when valid. */
  readonly validationError: string | null;
}

// ---------------------------------------------------------------------------
// WizardShell props — the reusable wizard layout component
// ---------------------------------------------------------------------------

/**
 * Props for {@link WizardShell} — the resource-agnostic wizard layout.
 *
 * Renders a step indicator, content area, and navigation footer.
 * The content for each step is provided via `children` — the wizard
 * shell does not know about step-specific rendering.
 */
export interface WizardShellProps {
  /** Step definitions for the progress indicator (only `id` and `label` are used for rendering). */
  readonly steps: readonly { readonly id: string; readonly label: string }[];
  /** Zero-based index of the currently active step. */
  readonly currentStepIndex: number;
  /** Content to render in the main area (the active step's UI). */
  readonly children: ReactNode;
  /** Label for the final step's action button (e.g. "Create agent"). */
  readonly submitLabel: string;
  /** Whether the submit action is currently in progress. */
  readonly isSubmitting?: boolean;
  /** Whether the "Next" / submit button should be disabled. */
  readonly canGoNext?: boolean;
  /** Whether the "Back" button should be shown. */
  readonly canGoBack?: boolean;
  /** Called when the user clicks "Next" or the submit button. */
  readonly onNext: () => void;
  /** Called when the user clicks "Back". */
  readonly onBack: () => void;
  /** Called when a completed step is clicked in the indicator (backward jump). */
  readonly onGoToStep?: (index: number) => void;
  /** Called when the user cancels the wizard entirely. */
  readonly onCancel?: () => void;
  /** Additional CSS classes for the root container. */
  readonly className?: string;
}
