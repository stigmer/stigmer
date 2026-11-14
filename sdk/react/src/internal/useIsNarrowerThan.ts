"use client";

// Whether an element is narrower than a width, measured as the element
// itself is laid out (ResizeObserver), not the viewport: a session docked in
// a narrow panel on a wide screen is narrow.

import { useLayoutEffect, useState, type RefObject } from "react";

/**
 * True while `ref`'s element is narrower than `widthPx`. False until it is
 * measured, and where the browser has no ResizeObserver (a test's DOM), so
 * an unmeasured element draws as a wide one.
 */
export function useIsNarrowerThan(ref: RefObject<HTMLElement | null>, widthPx: number): boolean {
  const [narrower, setNarrower] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width !== undefined) setNarrower(width < widthPx);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, widthPx]);
  return narrower;
}
