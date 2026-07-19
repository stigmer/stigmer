"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Pre-warm margin in pixels. The element is reported visible while it is
 * within this distance of the viewport, so consumers that attach expensive
 * resources on visibility (e.g. a live stream subscription) connect just
 * BEFORE the element scrolls into view and linger just after it leaves —
 * a fast scroll past a row never thrashes connect/disconnect.
 */
const PREWARM_MARGIN_PX = 200;

export interface UseInViewportReturn {
  /** Attach to the element whose viewport visibility is tracked. */
  readonly ref: React.RefObject<HTMLDivElement | null>;
  /** True while the element is within the pre-warmed viewport. */
  readonly isVisible: boolean;
}

/**
 * Headless viewport-visibility hook over `IntersectionObserver`.
 *
 * `root` is deliberately `null` (the top-level viewport): per the
 * IntersectionObserver spec, an element clipped by any intervening
 * scroll container (e.g. the workflow thread's own scroller) does not
 * intersect the viewport either, so nested scroll contexts are handled
 * without naming them. `display: none` subtrees report not-visible — a
 * CSS-hidden center view correctly suspends its visibility-gated work.
 *
 * Starts `false` until the observer's first callback; consumers should
 * treat visibility as an upgrade signal, not a render gate.
 *
 * @internal Not part of the public API (promote if a second consumer
 * appears outside the workflow thread).
 */
export function useInViewport(): UseInViewportReturn {
  const ref = useRef<HTMLDivElement | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const io = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (!entry) return;
        setIsVisible(entry.isIntersecting);
      },
      {
        root: null,
        rootMargin: `${PREWARM_MARGIN_PX}px 0px ${PREWARM_MARGIN_PX}px 0px`,
        threshold: 0,
      },
    );

    io.observe(el);
    return () => io.disconnect();
  }, []);

  return { ref, isVisible };
}
