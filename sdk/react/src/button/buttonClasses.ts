// The classes every action in the console is drawn with, in one place:
// Button, IconButton and LinkButton read them, and the approval card's
// DecisionButton takes its size from them, so no two actions drift apart.
//
// Height is set, not grown from padding, and every variant carries a 1px
// border (transparent on a fill), so a black button and a white one beside
// it are the same height. A preset's `--stgm-radius` and `--stgm-spacing`
// rescale all of it.

import { cn } from "@stigmer/design-tokens";

/**
 * Visual weight of an action, from most to least prominent.
 *
 * - `primary`: the filled call to action, one per view (an empty state's
 *   act, a dialog's confirm, a page's main act).
 * - `outline`: a secondary action on the card surface, beside content or
 *   beside a primary.
 * - `ghost`: borderless until hovered, for repeated actions in rows and
 *   for quiet acts such as Copy details.
 * - `destructive`: the filled danger action (a delete's confirm).
 */
export type ButtonVariant = "primary" | "outline" | "ghost" | "destructive";

/**
 * Size of an action. Every variant of a size is the same height.
 *
 * - `sm`: 32px at 14px text, a page's and a dialog's acts.
 * - `xs`: 28px at 12px text, a row's, a card's and a notice's acts.
 */
export type ButtonSize = "xs" | "sm";

const BASE = cn(
  "stg:inline-flex stg:shrink-0 stg:items-center stg:justify-center stg:rounded-lg stg:border stg:font-medium stg:whitespace-nowrap",
  "stg:no-underline stg:transition-colors stg:motion-reduce:transition-none",
  "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
  "stg:disabled:pointer-events-none stg:disabled:opacity-50",
  "stg:aria-disabled:pointer-events-none stg:aria-disabled:opacity-50",
);

const VARIANT: Record<ButtonVariant, string> = {
  primary: "stg:border-transparent stg:bg-primary stg:text-primary-foreground stg:hover:bg-primary-hover",
  outline: "stg:border-border stg:bg-card stg:text-foreground stg:hover:bg-accent-hover",
  ghost: "stg:border-transparent stg:text-foreground stg:hover:bg-accent-hover",
  destructive: "stg:border-transparent stg:bg-destructive stg:text-destructive-foreground stg:hover:bg-destructive-hover",
};

/** Each size's height, padding and type: 32px at 14/20, 28px at 12/16. */
export const BUTTON_SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "stg:h-8 stg:gap-1.5 stg:px-3 stg:text-sm",
  xs: "stg:h-7 stg:gap-1 stg:px-2.5 stg:text-xs",
};

/** An icon alone: a square of the size's height. */
const ICON_SIZE: Record<ButtonSize, string> = {
  sm: "stg:size-8",
  xs: "stg:size-7",
};

/** A ghost icon button rests in the muted tone and comes forward on hover. */
const ICON_GHOST = "stg:border-transparent stg:text-muted-foreground stg:hover:bg-accent-hover stg:hover:text-foreground";

/** The classes of an action with text. */
export function buttonClasses(variant: ButtonVariant, size: ButtonSize): string {
  return cn(BASE, BUTTON_SIZE_CLASSES[size], VARIANT[variant]);
}

/** The classes of an action that is an icon alone. */
export function iconButtonClasses(variant: ButtonVariant, size: ButtonSize): string {
  return cn(BASE, ICON_SIZE[size], variant === "ghost" ? ICON_GHOST : VARIANT[variant]);
}
