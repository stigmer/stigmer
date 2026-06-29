import { useLayoutEffect, useRef, useState } from "react";

export interface UseIsOverflowingReturn<T extends HTMLElement> {
  /** Attach to the element whose vertical overflow should be tracked. */
  readonly ref: React.RefObject<T | null>;
  /** `true` when the element's content is clipped by a vertical clamp (e.g. `overflow-hidden` + `max-h-*`). */
  readonly isOverflowing: boolean;
}

/**
 * Tracks whether a vertically-clamped element (e.g. one styled with
 * `overflow-hidden max-h-*`) is actually clipping its content at the current
 * height.
 *
 * The vertical analog of {@link useIsTextTruncated}: it measures
 * `scrollHeight > clientHeight` synchronously via `useLayoutEffect` (so the
 * first value is correct before paint — no flash) and keeps it in sync with
 * content-size changes via a `ResizeObserver`. The state setter compares before
 * writing, so a stable layout never triggers a re-render loop.
 *
 * Pass `enabled: false` to opt out entirely — the observer is not attached and
 * `isOverflowing` stays `false`. Callers gate on this so only the elements that
 * consume the signal pay for the measurement.
 *
 * Note: under a layout-free test environment (`happy-dom`) `scrollHeight` and
 * `clientHeight` are both `0`, so this reports `false`; overflow-driven UI is
 * therefore verified in the e2e (real-browser) layer, mirroring the split the
 * rest of the SDK already documents.
 *
 * @internal
 */
export function useIsOverflowing<T extends HTMLElement = HTMLElement>(
  enabled: boolean,
): UseIsOverflowingReturn<T> {
  const ref = useRef<T | null>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);

  useLayoutEffect(() => {
    if (!enabled) {
      // Reset so an element that stops consuming the signal doesn't keep a stale true.
      setIsOverflowing((prev) => (prev ? false : prev));
      return;
    }

    const el = ref.current;
    if (!el) return;

    const measure = () => {
      const next = el.scrollHeight > el.clientHeight + 1;
      setIsOverflowing((prev) => (prev === next ? prev : next));
    };

    measure();

    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [enabled]);

  return { ref, isOverflowing };
}
