"use client";

// An action drawn as an icon alone: a square Button whose name is required,
// read by a screen reader and shown as its tooltip, so an icon is never the
// only way to tell what a button does.

import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { cn } from "@stigmer/design-tokens";
import { Tooltip, TooltipContent, TooltipTrigger } from "../internal/tooltip.js";
import { iconButtonClasses, type ButtonSize, type ButtonVariant } from "./buttonClasses.js";

/** Props for {@link IconButton}. Extends the native button attributes, less its children and its own name. */
export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "aria-label" | "title"> {
  /** What the button does, in words ("Remove Grace Hopper"): its accessible name and its tooltip. */
  readonly label: string;
  /** The icon, drawn at 16px (14px at `xs`); mark it `aria-hidden`. */
  readonly icon: ReactNode;
  /** Visual weight. @default "ghost" */
  readonly variant?: ButtonVariant;
  /** Size: a 32px square, or 28px at `xs`. @default "sm" */
  readonly size?: ButtonSize;
  /** The underlying `<button>`, for a caller that moves focus to it. */
  readonly ref?: Ref<HTMLButtonElement>;
}

/**
 * An action drawn as an icon alone.
 *
 * A square of the button's height, `ghost` by default: muted at rest, the
 * foreground on hover. The `label` is required: it is the button's
 * accessible name and the tooltip it shows on hover and focus. A disabled
 * button still shows its tooltip, so a person can learn why it is off.
 *
 * This is an SDK component — embeddable by platform builders.
 *
 * @example
 * ```tsx
 * import { Trash2 } from "lucide-react";
 *
 * <IconButton label="Remove Grace Hopper" size="xs" icon={<Trash2 aria-hidden="true" />} onClick={remove} />
 * ```
 */
export function IconButton({ label, icon, variant = "ghost", size = "sm", type = "button", className, disabled, ...rest }: IconButtonProps) {
  const classes = cn(iconButtonClasses(variant, size), className);
  // A disabled button receives no pointer events, so its tooltip hangs on a
  // wrapper that does; an enabled one is the trigger itself.
  return (
    <Tooltip>
      {disabled ? (
        <TooltipTrigger render={<span className="stg:inline-flex" />}>
          <button type={type} aria-label={label} className={classes} disabled {...rest}>
            {icon}
          </button>
        </TooltipTrigger>
      ) : (
        <TooltipTrigger render={<button type={type} aria-label={label} className={classes} {...rest} />}>{icon}</TooltipTrigger>
      )}
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}
