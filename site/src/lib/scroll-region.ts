/**
 * A block that scrolls on its own, made reachable by the keyboard, for
 * every place the site draws one: the Markdown code blocks, the theme
 * playground's code blocks, the Markdown tables and the home page's code
 * samples.
 *
 * A scroll area that holds nothing focusable cannot be scrolled from the
 * keyboard: Tab passes it by and the arrow keys move nothing, so a long code
 * line or a wide table's right-hand columns are out of reach. axe reports it
 * as `scrollable-region-focusable` (WCAG 2.1.1; stigmer#2902, stigmer#3314, stigmer#3384).
 * The fix is the area itself in the tab order (`tabIndex: 0`); a focused
 * area scrolls with the arrow keys natively.
 *
 * Each area clips its own overflow, so the site's focus ring (`globals.css`,
 * drawn outside an element) would be cut off; it is drawn inside instead.
 *
 * Props, not a component, as the kit keeps the same rule
 * (`sdk/react/src/internal/scroll-region.ts`): they are spread onto
 * whatever scrolls, a fumadocs viewport or a table's wrapper.
 */
import type { HTMLAttributes } from "react";

/** The props every scroll area on the site takes: a Tab stop, its ring drawn inside. */
export const SCROLL_REGION = {
  tabIndex: 0,
  className: "focus-visible:outline-offset-[-2px]",
} satisfies HTMLAttributes<HTMLElement>;
