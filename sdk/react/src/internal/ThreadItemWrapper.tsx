"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";

interface ThreadItemWrapperProps {
  readonly animate: boolean;
  readonly children: ReactNode;
}

const ANIMATION_CLASS = "stgm-thread-item-enter";

/**
 * Thin wrapper that applies the `.stgm-thread-item-enter` CSS animation
 * on mount when `animate` is true. The class is removed after the
 * animation completes (via `onAnimationEnd`) to free the browser from
 * tracking a finished animation.
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

  if (!entering) {
    return children;
  }

  return (
    <div
      ref={divRef}
      className={ANIMATION_CLASS}
      onAnimationEnd={handleAnimationEnd}
    >
      {children}
    </div>
  );
}
