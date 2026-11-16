"use client";

import { cn } from "@stigmer/design-tokens";
import { Checkbox } from "../../internal/form/index.js";

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
    <Checkbox
      role="checkbox"
      checked={checked}
      ref={(el) => {
        if (el) el.indeterminate = indeterminate;
      }}
      onChange={(e) => onChange(e.target.checked)}
      aria-label={ariaLabel} className={cn("stg:shrink-0", className)}
    />
  );
}
