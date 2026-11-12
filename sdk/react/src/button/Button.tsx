"use client";

// The console's one action button. Its look lives in buttonClasses.ts, which
// IconButton and LinkButton share, so every action draws the same.

import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { cn } from "@stigmer/design-tokens";

import { buttonClasses, type ButtonSize, type ButtonVariant } from "./buttonClasses.js";

export type { ButtonSize, ButtonVariant } from "./buttonClasses.js";

/** Props for {@link Button}. Extends the native button attributes. */
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual weight. @default "primary" */
  readonly variant?: ButtonVariant;
  /** Size. @default "sm" */
  readonly size?: ButtonSize;
  /** Optional leading icon, rendered before the label. */
  readonly icon?: ReactNode;
  /** The underlying `<button>`, for a caller that moves focus to it. */
  readonly ref?: Ref<HTMLButtonElement>;
}

/**
 * The SDK's shared button primitive.
 *
 * A thin, token-compliant wrapper over the native `<button>`: four
 * variants and two sizes cover every action in the console, and every
 * variant of a size is the same height (32px, or 28px at `xs`), so a
 * filled and an outlined button line up side by side. Everything else
 * (handlers, ARIA, `disabled`, `form`) passes through natively.
 * `type` defaults to `"button"` so a button inside a form never submits
 * it accidentally.
 *
 * All visual properties flow through `--stgm-*` design tokens;
 * hover states use dedicated hover tokens, never opacity modifiers.
 *
 * For an icon alone use {@link IconButton}; for a link that looks like a
 * button use {@link LinkButton}.
 *
 * This is an SDK component — embeddable by platform builders.
 *
 * @example
 * ```tsx
 * import { Plus } from "lucide-react";
 *
 * function AddChannelButton({ onAdd }: { onAdd: () => void }) {
 *   return (
 *     <Button variant="outline" size="xs" icon={<Plus />} onClick={onAdd}>
 *       Add channel
 *     </Button>
 *   );
 * }
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
      className={cn(buttonClasses(variant, size), className)}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}
