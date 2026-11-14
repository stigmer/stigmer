"use client";

import { cn } from "@stigmer/design-tokens";
import { SpinnerIcon } from "../internal/thread-card/glyphs.js";
import { BUTTON_SIZE_CLASSES, type ButtonSize } from "../button/buttonClasses.js";

/** The visual weight of a {@link DecisionButton}. */
export type DecisionVariant = "primary" | "outline" | "ghost" | "danger";

/** Props for {@link DecisionButton}. */
export interface DecisionButtonProps {
  /** Visible button text; also used as the accessible name. */
  readonly label: string;
  /**
   * Visual weight. `primary` is the kit's filled primary (the single
   * recommended action), `outline` the kit's outlined button (its
   * alternative), `ghost` the lowest-weight neutral action, and `danger` a
   * ghost that reveals a destructive cue on hover/focus.
   */
  readonly variant: DecisionVariant;
  /** The kit's button size: `sm` 32px at 14/20, `xs` 28px at 12/16. @default "xs" */
  readonly size?: ButtonSize;
  /** Invoked on click. */
  readonly onClick: () => void;
  /** True while ANY decision RPC is in flight — disables every button. */
  readonly isSubmitting?: boolean;
  /** True when THIS button's RPC is the one in flight — shows the spinner. */
  readonly isActive?: boolean;
  /**
   * Disables the button independent of {@link isSubmitting} — e.g. an action that
   * is structurally unavailable (approving an incomplete, unreviewable diff).
   */
  readonly disabled?: boolean;
  /** Extra classes (e.g. `ml-auto` to visually separate a demoted action). */
  readonly className?: string;
  /** Stable hook for e2e/visual targeting (`data-cursor-target`). */
  readonly cursorTarget?: string;
  /**
   * Id of an element that explains this button — wired to `aria-describedby` so a
   * disabled, structurally-unavailable action (e.g. approving an unreviewable
   * change) is associated with the notice stating why.
   */
  readonly ariaDescribedby?: string;
}

// Its height, padding and type are the kit's button sizes (button/buttonClasses.ts),
// so the approval card's actions and every other action share the kit's scale.
const BASE = cn(
  "stg:inline-flex stg:items-center stg:justify-center stg:rounded-md stg:border stg:font-medium stg:transition-colors",
  "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring stg:focus-visible:ring-offset-2",
  // Disabled dimming is ELEMENT opacity (allowed), never a `bg-token/NN` opacity
  // modifier — each preset keeps full control of the token colors themselves.
  "stg:disabled:cursor-not-allowed stg:disabled:opacity-50 stg:disabled:pointer-events-none",
);

// Token-only; the primary and outline are the kit's own buttons' looks.
const VARIANT: Record<DecisionVariant, string> = {
  // The single primary action: the kit's filled primary, black in the
  // monochrome theme. It reads as primary by fill against the outline beside
  // it, not by hue alone.
  primary: "stg:border-transparent stg:bg-primary stg:text-primary-foreground stg:hover:bg-primary-hover",
  // The kit's outline: the alternative beside the primary.
  outline: "stg:border-border stg:bg-card stg:text-foreground stg:hover:bg-accent-hover",
  // The canonical SDK ghost: no fill at rest, neutral wash on hover.
  ghost: "stg:border-transparent stg:text-muted-foreground stg:hover:text-foreground stg:hover:bg-accent-hover",
  // Quiet at rest; the destructive cue is revealed on hover AND keyboard focus
  // (parity for keyboard users — not hover-only). A persistent red button is
  // unnecessary: rejecting is the safe action, and a destructive tool gate is
  // already flagged by the card's accent.
  danger: cn(
    "stg:border-transparent stg:text-muted-foreground",
    "stg:hover:bg-destructive-subtle stg:hover:text-destructive",
    "stg:focus-visible:bg-destructive-subtle stg:focus-visible:text-destructive",
  ),
};

/**
 * The shared decision-action button for every approval surface, starting
 * with the agent tool gate ({@link ApprovalCard}).
 *
 * One source of truth for the quiet, Cursor-grade button system so the
 * surfaces can never visually drift, and so the spinner and base chrome live in
 * exactly one place. Every visual property flows through `--stgm-*` tokens.
 *
 * @internal Not part of the public API.
 */
export function DecisionButton({
  label,
  variant,
  size = "xs",
  onClick,
  isSubmitting = false,
  isActive = false,
  disabled = false,
  className,
  cursorTarget,
  ariaDescribedby,
}: DecisionButtonProps) {
  return (
    <button
      type="button"
      disabled={isSubmitting || disabled}
      onClick={onClick}
      aria-label={label}
      aria-describedby={ariaDescribedby}
      data-cursor-target={cursorTarget}
      className={cn(BASE, BUTTON_SIZE_CLASSES[size], VARIANT[variant], className)}
    >
      {isActive && isSubmitting ? <SpinnerIcon /> : null}
      {label}
    </button>
  );
}

