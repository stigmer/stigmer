"use client";

// Whether an element is narrower than a width, measured as the element
// itself is laid out (ResizeObserver), not the viewport: a session docked in
// a narrow panel on a wide screen is narrow.

import { useLayoutEffect, useState, type RefObject } from "react";

/**
 * True while `ref`'s element is narrower than `widthPx`, measured before the
 * first paint and again as it resizes. False until it is laid out, and where
 * the browser has no ResizeObserver (a test's DOM), so an unmeasured element
 * draws as a wide one.
 */
export function useIsNarrowerThan(ref: RefObject<HTMLElement | null>, widthPx: number): boolean {
  const [narrower, setNarrower] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null || typeof ResizeObserver === "undefined") return;
    // Measured once before the first paint, so a narrow element never draws
    // wide and then redraws (a layout effect's update renders before the
    // browser paints). An element not laid out yet reports no width.
    const first = element.getBoundingClientRect().width;
    if (first > 0) setNarrower(first < widthPx);
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width !== undefined) setNarrower(width < widthPx);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, widthPx]);
  return narrower;
}
