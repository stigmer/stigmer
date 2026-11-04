"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import { cn } from "@stigmer/design-tokens";

interface ThreadItemWrapperProps {
  readonly animate: boolean;
  readonly children: ReactNode;
}

const ANIMATION_CLASS = "stgm-thread-item-enter";

/**
 * An item that renders nothing (a turn with no outcome to show) leaves an
 * empty wrapper, which must take no room in the thread's gapped column.
 */
const WRAPPER_CLASS = "stg:empty:hidden";

/**
 * Thin wrapper that applies the `.stgm-thread-item-enter` CSS animation
 * on mount when `animate` is true. The class is removed after the
 * animation completes (via `onAnimationEnd`) to free the browser from
 * tracking a finished animation.
 *
 * The wrapper renders the same `div` for its whole life, animated or not,
 * entering or settled: only its class changes. A root that changed from the
 * `div` to the bare children when the animation ended made React replace
 * the whole item, and with it the keyboard focus, hover and any half-made
 * click on a control inside it, such as an approval gate's Approve
 * (stigmer/stigmer#1570). An item that renders nothing hides its empty
 * wrapper, so it takes no gap in the column, as it did when it was no
 * element at all.
 *
 * A fallback timeout removes the class if `animationend` never fires
 * (e.g. `prefers-reduced-motion` sets duration to ~0ms, or the test
 * environment doesn't dispatch animation events).
 *
 * @internal Not part of the public API.
 */
export function ThreadItemWrapper({ animate, children }: ThreadItemWrapperProps) {
  const [entering, setEntering] = useState(animate);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const handleAnimationEnd = useCallback(() => {
    setEntering(false);
    if (timerRef.current !== undefined) {
      clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
  }, []);

  const divRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (timerRef.current !== undefined) {
        clearTimeout(timerRef.current);
        timerRef.current = undefined;
      }
      if (node && entering) {
        timerRef.current = setTimeout(() => {
          setEntering(false);
          timerRef.current = undefined;
        }, 300);
      }
    },
    [entering],
  );

  return (
    <div
      ref={divRef}
      className={cn(WRAPPER_CLASS, entering && ANIMATION_CLASS)}
      onAnimationEnd={handleAnimationEnd}
    >
      {children}
    </div>
  );
}
