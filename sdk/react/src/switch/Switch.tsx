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
        "stg:relative stg:inline-flex stg:h-5 stg:w-9 stg:shrink-0 stg:items-center stg:rounded-full stg:transition-colors",
        "stg:motion-reduce:transition-none",
        checked ? "stg:bg-primary" : "stg:bg-input",
        "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring stg:focus-visible:ring-offset-2",
        "stg:disabled:pointer-events-none stg:disabled:opacity-50",
        // Expanded invisible hit area (~44px tall) for touch targets.
        "stg:after:absolute stg:after:-inset-3 stg:after:content-['']",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "stg:pointer-events-none stg:block stg:size-4 stg:rounded-full stg:bg-background stg:shadow-sm stg:transition-transform",
          "stg:motion-reduce:transition-none",
          checked ? "stg:translate-x-[18px]" : "stg:translate-x-0.5",
        )}
      />
    </button>
  );
}
