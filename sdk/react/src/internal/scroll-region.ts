// ---------------------------------------------------------------------------
// A block that scrolls on its own, made reachable by the keyboard.
// Internal — never exported from the package barrel.
//
// A block with overflow (a manifest, a snippet, a ticket, a timeline) that
// holds nothing focusable cannot be scrolled from the keyboard: Tab passes it
// by and the arrow keys move nothing. axe reports it as
// `scrollable-region-focusable` (WCAG 2.1.1). The fix is the block itself in
// the tab order, named so a screen reader says what it is, and showing the
// kit's focus ring when it has focus (WCAG 2.4.7); a focused block scrolls
// with the arrow keys natively.
//
// Props plus a class constant, not a component: the blocks are a `pre`, a
// `code` and a `div`, each with its own ref and classes, and spread props
// compose with all of them without a polymorphic wrapper.
// ---------------------------------------------------------------------------

/** The attributes that make a scrolling block a named, focusable region. */
export interface ScrollRegionProps {
  readonly role: "region";
  readonly "aria-label": string;
  readonly tabIndex: 0;
}

/**
 * Spread onto the element that scrolls: `<pre {...scrollRegion("Slack app
 * manifest")} className={cn(..., SCROLL_REGION_FOCUS)}>`. The label is what a
 * screen reader announces, so it names the content, not the act.
 */
export function scrollRegion(label: string): ScrollRegionProps {
  return { role: "region", "aria-label": label, tabIndex: 0 };
}

/** The kit's focus ring, shown when a scroll region has keyboard focus. */
export const SCROLL_REGION_FOCUS =
  "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring";
