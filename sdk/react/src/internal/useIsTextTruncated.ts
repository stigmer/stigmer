import { useLayoutEffect, useRef, useState } from "react";

export interface UseIsTextTruncatedReturn<T extends HTMLElement> {
  /** Attach to the element whose horizontal overflow should be tracked. */
  readonly ref: React.RefObject<T | null>;
  /** `true` when the element's content is clipped by `overflow` (e.g. `truncate`). */
  readonly isTruncated: boolean;
}

/**
 * Tracks whether a single-line, overflow-clipped element (e.g. one styled with
 * Tailwind's `truncate`) is actually truncating its text at the current width.
 *
 * The horizontal analog of {@link useScrollShadows}: it measures
 * `scrollWidth > clientWidth` synchronously via `useLayoutEffect` (so the first
 * value is correct before paint — no flash) and keeps it in sync with width
 * changes via a `ResizeObserver`. The state setter compares before writing, so a
 * stable layout never triggers a re-render loop.
 *
 * Pass `enabled: false` to opt a row out entirely — the observer is not attached
 * and `isTruncated` stays `false`. Callers gate on this so only the rows that
 * consume the signal pay for the measurement.
 *
 * @internal
 */
export function useIsTextTruncated<T extends HTMLElement = HTMLElement>(
  enabled: boolean,
): UseIsTextTruncatedReturn<T> {
  const ref = useRef<T | null>(null);
  const [isTruncated, setIsTruncated] = useState(false);

  useLayoutEffect(() => {
    if (!enabled) {
      // Reset so a row that stops consuming the signal doesn't keep a stale true.
      setIsTruncated((prev) => (prev ? false : prev));
      return;
    }

    const el = ref.current;
    if (!el) return;

    const measure = () => {
      const next = el.scrollWidth > el.clientWidth + 1;
      setIsTruncated((prev) => (prev === next ? prev : next));
    };

    measure();

    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [enabled]);

  return { ref, isTruncated };
}
