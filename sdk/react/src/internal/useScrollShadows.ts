import { useCallback, useEffect, useRef, useState } from "react";

export interface UseScrollShadowsReturn {
  /** Attach to the scrollable container element. */
  readonly scrollRef: React.RefObject<HTMLDivElement | null>;
  /** `true` when the container has hidden content above the visible area. */
  readonly canScrollUp: boolean;
  /** `true` when the container has hidden content below the visible area. */
  readonly canScrollDown: boolean;
}

/**
 * Tracks whether a scrollable container can scroll up, down, or both.
 *
 * Attaches a passive `scroll` listener and a `ResizeObserver` to the
 * referenced element so the returned booleans stay in sync with both
 * user scrolling and content-size changes (e.g., new items appended).
 *
 * Pair with {@link ScrollFade} to render gradient overlays that signal
 * hidden content above or below.
 *
 * @internal
 */
export function useScrollShadows(): UseScrollShadowsReturn {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [canScrollUp, setCanScrollUp] = useState(false);
  const [canScrollDown, setCanScrollDown] = useState(false);

  const update = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollUp(el.scrollTop > 0);
    setCanScrollDown(el.scrollTop + el.clientHeight < el.scrollHeight - 1);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    el.addEventListener("scroll", update, { passive: true });

    const ro = new ResizeObserver(update);
    ro.observe(el);

    update();

    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [update]);

  return { scrollRef, canScrollUp, canScrollDown };
}
