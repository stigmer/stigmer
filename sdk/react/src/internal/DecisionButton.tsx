"use client";

import { cn } from "@stigmer/theme";

/** The visual weight of a {@link DecisionButton}. */
export type DecisionVariant = "primary" | "ghost" | "danger";

/** Props for {@link DecisionButton}. */
export interface DecisionButtonProps {
  /** Visible button text; also used as the accessible name. */
  readonly label: string;
  /**
   * Visual weight. `primary` is the quiet neutral chip (the single recommended
   * action), `ghost` is the lowest-weight neutral action, and `danger` is a
   * ghost that reveals a destructive cue on hover/focus.
   */
  readonly variant: DecisionVariant;
  /** Invoked on click. */
  readonly onClick: () => void;
  /** True while ANY decision RPC is in flight — disables every button. */
  readonly isSubmitting?: boolean;
  /** True when THIS button's RPC is the one in flight — shows the spinner. */
  readonly isActive?: boolean;
  /** Extra classes (e.g. `ml-auto` to visually separate a demoted action). */
  readonly className?: string;
  /** Stable hook for e2e/visual targeting (`data-cursor-target`). */
  readonly cursorTarget?: string;
}

const BASE = cn(
  "inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5",
  "text-xs font-medium transition-colors",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
  // Disabled dimming is ELEMENT opacity (allowed), never a `bg-token/NN` opacity
  // modifier — each preset keeps full control of the token colors themselves.
  "disabled:cursor-not-allowed disabled:opacity-50 disabled:pointer-events-none",
);

// Quiet, Cursor-grade, token-only.
const VARIANT: Record<DecisionVariant, string> = {
  // Neutral chip: the single primary action. It reads as primary by fill-weight
  // and border against the ghost actions — NOT by hue — so the hierarchy holds
  // without color being the only channel (a11y).
  primary:
    "border border-border bg-accent text-accent-foreground hover:bg-accent-hover",
  // The canonical SDK ghost: no fill at rest, neutral wash on hover.
  ghost: "text-muted-foreground hover:text-foreground hover:bg-accent-hover",
  // Quiet at rest; the destructive cue is revealed on hover AND keyboard focus
  // (parity for keyboard users — not hover-only). A persistent red button is
  // unnecessary: rejecting is the safe action, and a destructive tool gate is
  // already flagged by the card's accent.
  danger: cn(
    "text-muted-foreground",
    "hover:bg-destructive-subtle hover:text-destructive",
    "focus-visible:bg-destructive-subtle focus-visible:text-destructive",
  ),
};

/**
 * The shared decision-action button for every approval surface — the agent
 * tool gate ({@link ApprovalCard}) and the two workflow approval cards
 * ({@link WorkflowTaskApprovalCard}, {@link WorkflowExecutionApprovalCard}).
 *
 * One source of truth for the quiet, Cursor-grade button system so the three
 * surfaces can never visually drift, and so the spinner and base chrome live in
 * exactly one place. Every visual property flows through `--stgm-*` tokens.
 *
 * @internal Not part of the public API.
 */
export function DecisionButton({
  label,
  variant,
  onClick,
  isSubmitting = false,
  isActive = false,
  className,
  cursorTarget,
}: DecisionButtonProps) {
  return (
    <button
      type="button"
      disabled={isSubmitting}
      onClick={onClick}
      aria-label={label}
      data-cursor-target={cursorTarget}
      className={cn(BASE, VARIANT[variant], className)}
    >
      {isActive && isSubmitting ? <SpinnerIcon /> : null}
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Inline SVG icon
// ---------------------------------------------------------------------------

function SpinnerIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className="animate-spin"
      aria-hidden="true"
    >
      <path d="M6 1.5A4.5 4.5 0 1 1 1.5 6" strokeLinecap="round" />
    </svg>
  );
}
