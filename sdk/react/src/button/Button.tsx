"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@stigmer/theme";

/**
 * Visual weight of a {@link Button}, from most to least prominent.
 *
 * - `primary` — filled call to action (one per view: empty-state CTAs,
 *   dialog confirms).
 * - `outline` — bordered pill for secondary actions that share a row
 *   with content (list-header actions like "Create share").
 * - `ghost` — borderless, hover-surfaced; for repeated inline actions
 *   (table row actions) where borders would add noise.
 * - `destructive` — filled danger action (dialog confirms for deletes).
 *   For inline destructive row actions prefer `ghost` with destructive
 *   text styling via `className`.
 */
export type ButtonVariant = "primary" | "outline" | "ghost" | "destructive";

/**
 * Size of a {@link Button}.
 *
 * - `xs` — compact pill (list headers, table rows).
 * - `sm` — standard (empty-state CTAs, dialog actions).
 */
export type ButtonSize = "xs" | "sm";

/** Props for {@link Button}. Extends the native button attributes. */
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual weight. @default "primary" */
  readonly variant?: ButtonVariant;
  /** Size. @default "sm" */
  readonly size?: ButtonSize;
  /** Optional leading icon, rendered before the label. */
  readonly icon?: ReactNode;
}

// One source of truth for each tier's classes: every mapping below is the
// established idiom already used across the SDK (list-header pills,
// EmptyState CTAs, ConfirmDialog actions) — collected here so surfaces
// can stop hand-rolling drifting copies of the same button.
const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "stg:bg-primary stg:text-primary-foreground stg:hover:bg-primary-hover",
  outline: "stg:border stg:border-border stg:text-foreground stg:hover:bg-accent-hover",
  ghost: "stg:text-foreground stg:hover:bg-accent-hover",
  destructive:
    "stg:bg-destructive stg:text-destructive-foreground stg:hover:bg-destructive-hover",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  xs: "stg:px-2.5 stg:py-1 stg:text-xs",
  sm: "stg:px-3 stg:py-1.5 stg:text-xs",
};

/**
 * The SDK's shared button primitive.
 *
 * A thin, token-compliant wrapper over the native `<button>`: variants
 * and sizes cover the console's established action tiers, everything
 * else (handlers, ARIA, `disabled`, `form`) passes through natively.
 * `type` defaults to `"button"` so a button inside a form never submits
 * it accidentally.
 *
 * All visual properties flow through `--stgm-*` design tokens (DD-005);
 * hover states use dedicated hover tokens, never opacity modifiers.
 *
 * This is an SDK component (DD-001) — embeddable by platform builders.
 *
 * @example
 * ```tsx
 * <Button variant="outline" size="xs" icon={<PlusIcon />} onClick={onCreate}>
 *   Create share
 * </Button>
 * ```
 */
export function Button({
  variant = "primary",
  size = "sm",
  icon,
  type = "button",
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "stg:inline-flex stg:items-center stg:gap-1 stg:rounded-md stg:font-medium stg:transition-colors",
        "stg:motion-reduce:transition-none",
        "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
        "stg:disabled:pointer-events-none stg:disabled:opacity-50",
        SIZE_CLASSES[size],
        VARIANT_CLASSES[variant],
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}
