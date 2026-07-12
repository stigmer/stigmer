"use client";

import { cn } from "@stigmer/theme";

/** Props for {@link Switch}. */
export interface SwitchProps {
  /** Whether the switch is on. */
  readonly checked: boolean;
  /** Called with the next value when the user toggles the switch. */
  readonly onCheckedChange: (checked: boolean) => void;
  /** When `true`, the switch is shown but non-interactive. */
  readonly disabled?: boolean;
  /**
   * Accessible name. Required unless `aria-labelledby` points at a
   * visible label element.
   */
  readonly "aria-label"?: string;
  /** ID of the element that labels this switch. */
  readonly "aria-labelledby"?: string;
  /** Element ID, for association with an external `<label htmlFor>`. */
  readonly id?: string;
  /** Additional CSS classes for the root button. */
  readonly className?: string;
}

/**
 * Accessible on/off toggle following the WAI-ARIA Switch pattern.
 *
 * Built on a native `<button role="switch">` so Space/Enter activation,
 * focus, and disabled semantics come from the platform. `aria-checked`
 * reflects the state for assistive technology.
 *
 * Use a switch only for instant binary state changes that take effect
 * immediately (e.g. enabling sharing) — not for choices that need a
 * separate save step (use radios or a select for those).
 *
 * The visible track is compact; an invisible expanded hit area keeps the
 * touch target at ~44px without disturbing layout. All visual properties
 * flow through `--stgm-*` design tokens, and the thumb transition is
 * suppressed under `prefers-reduced-motion`.
 *
 * @example
 * ```tsx
 * <Switch
 *   checked={sharing.enabled}
 *   onCheckedChange={(next) => save({ ...sharing, enabled: next })}
 *   aria-label="Enable sharing"
 * />
 * ```
 */
export function Switch({
  checked,
  onCheckedChange,
  disabled,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledby,
  id,
  className,
}: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledby}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        // Track. `relative` anchors both the thumb and the expanded hit area.
        // Off state uses the form-control token (`--stgm-input`), NOT
        // `bg-muted`: muted matches the popover surface in dark presets, which
        // made the track invisible inside dialogs. Both track fills are
        // registered as surface pairs in the theme contrast contract
        // (@stigmer/theme contract/pairs.ts), so every preset is audited.
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
        "motion-reduce:transition-none",
        checked ? "bg-primary" : "bg-input",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        "disabled:pointer-events-none disabled:opacity-50",
        // Expanded invisible hit area (~44px tall) for touch targets.
        "after:absolute after:-inset-3 after:content-['']",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none block size-4 rounded-full bg-background shadow-sm transition-transform",
          "motion-reduce:transition-none",
          checked ? "translate-x-[18px]" : "translate-x-0.5",
        )}
      />
    </button>
  );
}
