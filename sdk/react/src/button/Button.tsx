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
  primary: "bg-primary text-primary-foreground hover:bg-primary-hover",
  outline: "border border-border text-foreground hover:bg-accent-hover",
  ghost: "text-foreground hover:bg-accent-hover",
  destructive:
    "bg-destructive text-destructive-foreground hover:bg-destructive-hover",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  xs: "px-2.5 py-1 text-xs",
  sm: "px-3 py-1.5 text-xs",
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
        "inline-flex items-center gap-1 rounded-md font-medium transition-colors",
        "motion-reduce:transition-none",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:pointer-events-none disabled:opacity-50",
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
