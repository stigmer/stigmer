"use client";

import { cn } from "@stigmer/theme";

/** Props for {@link SelectionCheckbox}. */
export interface SelectionCheckboxProps {
  /** Whether the checkbox is checked. */
  readonly checked: boolean;
  /**
   * Indeterminate state (e.g. header checkbox when some but not all
   * rows are selected). Overrides `checked` visually.
   */
  readonly indeterminate?: boolean;
  /** Called when the user toggles the checkbox. */
  readonly onChange: (checked: boolean) => void;
  /** Accessible label for the checkbox. */
  readonly "aria-label": string;
  /** Additional CSS classes. */
  readonly className?: string;
}

/**
 * Accessible checkbox for row/card selection and "select all" headers.
 *
 * Uses a native `<input type="checkbox">` with the `indeterminate`
 * property set via ref for proper browser + screen reader support.
 */
export function SelectionCheckbox({
  checked,
  indeterminate = false,
  onChange,
  "aria-label": ariaLabel,
  className,
}: SelectionCheckboxProps) {
  return (
    <input
      type="checkbox"
      role="checkbox"
      checked={checked}
      ref={(el) => {
        if (el) el.indeterminate = indeterminate;
      }}
      onChange={(e) => onChange(e.target.checked)}
      aria-label={ariaLabel}
      className={cn(
        "stg:size-3.5 stg:shrink-0 stg:cursor-pointer stg:rounded stg:border stg:border-input stg:accent-primary",
        "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring stg:focus-visible:ring-offset-1",
        className,
      )}
    />
  );
}
