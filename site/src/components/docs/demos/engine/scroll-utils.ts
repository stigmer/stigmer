/**
 * Shared scroll helpers used by both the Cursor component and
 * the useStepInteractions hook.
 */

/**
 * Walk up the DOM tree to find the nearest scrollable ancestor
 * of the given element (one with `overflow-y: auto` or `scroll`).
 */
export function findScrollParent(el: Element): Element | null {
  let parent = el.parentElement;
  while (parent) {
    const { overflowY } = getComputedStyle(parent);
    if (overflowY === "auto" || overflowY === "scroll") return parent;
    parent = parent.parentElement;
  }
  return null;
}

/**
 * Scroll the target element into view inside its nearest scrollable
 * ancestor using the browser's native `scrollIntoView`. This handles
 * CSS `zoom` correctly (manual `scrollTop` arithmetic does not).
 *
 * After scrolling the internal container, page scroll is immediately
 * restored so the demo block doesn't jump on the page.
 *
 * @returns `true` when scrolling was necessary.
 */
export function scrollTargetIntoView(el: Element): boolean {
  const scrollParent = findScrollParent(el);
  if (!scrollParent) return false;

  const pRect = scrollParent.getBoundingClientRect();
  const eRect = el.getBoundingClientRect();
  const isVisible = eRect.top >= pRect.top && eRect.bottom <= pRect.bottom;
  if (isVisible) return false;

  const pageX = window.scrollX;
  const pageY = window.scrollY;
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  window.scrollTo(pageX, pageY);
  return true;
}

/**
 * Instant-scroll variant for video export where smooth scrolling
 * doesn't work across Remotion frames. Sets `scrollTop` directly
 * on the nearest scrollable ancestor.
 */
export function scrollTargetIntoViewInstant(el: Element): void {
  const scrollParent = findScrollParent(el);
  if (!scrollParent) return;

  const pRect = scrollParent.getBoundingClientRect();
  const eRect = el.getBoundingClientRect();
  const isVisible = eRect.top >= pRect.top && eRect.bottom <= pRect.bottom;
  if (isVisible) return;

  const pageX = window.scrollX;
  const pageY = window.scrollY;
  el.scrollIntoView({ block: "center", behavior: "instant" });
  window.scrollTo(pageX, pageY);
}
