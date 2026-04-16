"use client";

import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useTimeSource } from "./TimeSource";
import { findScrollParent, scrollTargetIntoView } from "./scroll-utils";
import { CLICK_DELAY_MS } from "./timing";

interface CursorProps {
  /**
   * Value of the `data-cursor-target` attribute on the element the
   * cursor should point at. When `undefined`, the cursor fades out.
   */
  target?: string;
  /** Container element used for relative position calculations. */
  containerRef: RefObject<HTMLDivElement | null>;
  /**
   * Whether to show the click ripple when the cursor arrives at a
   * target. Defaults to `true`. Set to `false` during hover
   * interactions where the cursor should dwell without clicking.
   */
  showRipple?: boolean;
}

interface Position {
  x: number;
  y: number;
}

const SPRING = {
  type: "spring",
  stiffness: 170,
  damping: 22,
  mass: 0.6,
} as const;

const RETRY_INTERVAL_MS = 80;
const MAX_RETRIES = 12;
const SCROLL_SETTLE_MS = 400;
const RESIZE_DEBOUNCE_MS = 100;

/**
 * Compute cursor position relative to the container, accounting for
 * CSS zoom on ancestors. `getBoundingClientRect` returns viewport
 * coordinates (post-zoom), but `position: absolute` inside a
 * CSS-zoomed container uses pre-zoom coordinates. Dividing by the
 * effective zoom converts viewport offsets back to CSS space.
 */
function computeCursorPosition(
  container: HTMLElement,
  el: Element,
): Position {
  const cRect = container.getBoundingClientRect();
  const eRect = el.getBoundingClientRect();
  const zoom = cRect.width / container.offsetWidth || 1;

  return {
    x: (eRect.left - cRect.left + eRect.width / 2) / zoom,
    y: (eRect.top - cRect.top + eRect.height / 2) / zoom,
  };
}

function warnIfTargetObscured(target: string, el: Element): void {
  if (process.env.NODE_ENV !== "development") return;
  const scrollParent = findScrollParent(el);
  if (!scrollParent) return;
  const pr = scrollParent.getBoundingClientRect();
  const er = el.getBoundingClientRect();
  if (er.top < pr.top || er.bottom > pr.bottom) {
    console.warn(
      `[Cursor] Target "${target}" is not fully visible in its scroll container. ` +
        `Add a scroll-to interaction before this step, or adjust the content layout.\n` +
        `  target: top=${er.top.toFixed(0)} bottom=${er.bottom.toFixed(0)}\n` +
        `  container: top=${pr.top.toFixed(0)} bottom=${pr.bottom.toFixed(0)}`,
    );
  }
}

/**
 * Animated cursor overlay for guided-tour demos.
 *
 * Renders a small pointer that smoothly animates to the target
 * element (identified by `data-cursor-target` attribute) and plays
 * a click ripple animation upon arrival.
 *
 * When the target element doesn't exist yet (e.g. SDK component
 * still loading async data), the cursor polls until it appears
 * (up to ~1 s). When found, it smooth-scrolls the element into view
 * within its nearest scrollable ancestor, waits for the scroll to
 * settle, then positions and clicks.
 *
 * Fades out when no target is set, fades in when a target appears.
 * Fully non-interactive (`pointer-events-none`).
 */
export function Cursor({ target, containerRef, showRipple = true }: CursorProps) {
  const [pos, setPos] = useState<Position | null>(null);
  const timeSource = useTimeSource();

  // ---------------------------------------------------------------------------
  // Browser-only clicking state (setTimeout-driven)
  // ---------------------------------------------------------------------------
  const [browserClicking, setBrowserClicking] = useState(false);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // ---------------------------------------------------------------------------
  // Video-export clicking state (timeline-derived)
  //
  // Records the timeline time when a new target appeared. The click
  // ripple triggers once CLICK_DELAY_MS has elapsed, matching the
  // browser path's setTimeout behaviour deterministically.
  // ---------------------------------------------------------------------------
  const [targetArrivalMs, setTargetArrivalMs] = useState<number | null>(null);
  const prevTargetRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!timeSource) return;
    if (target !== prevTargetRef.current) {
      prevTargetRef.current = target;
      setTargetArrivalMs(target ? timeSource.currentTimeMs : null);
    }
    // Only react to target identity changes, not every frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  const videoClicking =
    showRipple &&
    timeSource != null &&
    targetArrivalMs != null &&
    timeSource.currentTimeMs - targetArrivalMs >= CLICK_DELAY_MS;

  const isClicking = timeSource ? videoClicking : browserClicking;

  // ---------------------------------------------------------------------------
  // Video-export path: compute position synchronously.
  //
  // Runs when `target` changes — not every frame. The effect checks
  // for the TimeSource context but does not depend on it so the
  // unstable context reference does not cause per-frame re-runs.
  // ---------------------------------------------------------------------------
  const isVideoRef = useRef(false);
  isVideoRef.current = timeSource != null;

  useEffect(() => {
    if (!isVideoRef.current) return;

    if (!target) {
      setPos(null);
      return;
    }

    const container = containerRef.current;
    if (!container) return;

    const el = container.querySelector(`[data-cursor-target="${target}"]`);
    if (!el) return;

    warnIfTargetObscured(target, el);
    setPos(computeCursorPosition(container, el));
  }, [target, containerRef]);

  // ---------------------------------------------------------------------------
  // Live-site path: poll for target, scroll, settle, then animate.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (isVideoRef.current) return;

    clearTimeout(clickTimerRef.current);
    clearTimeout(retryTimerRef.current);
    clearTimeout(settleTimerRef.current);
    setBrowserClicking(false);

    if (!target) {
      setPos(null);
      return;
    }

    let cancelled = false;
    let retries = 0;

    function tryFind() {
      if (cancelled) return;

      const container = containerRef.current;
      if (!container) return;

      const el = container.querySelector(
        `[data-cursor-target="${target}"]`,
      );
      if (!el) {
        if (retries < MAX_RETRIES) {
          retries++;
          retryTimerRef.current = setTimeout(tryFind, RETRY_INTERVAL_MS);
        } else if (process.env.NODE_ENV === "development") {
          console.warn(
            `[Cursor] Could not find target "${target}" after ${MAX_RETRIES} retries. ` +
              `Ensure a [data-cursor-target="${target}"] element exists in the container.`,
          );
        }
        return;
      }

      const didScroll = scrollTargetIntoView(el);

      settleTimerRef.current = setTimeout(
        () => {
          requestAnimationFrame(() => {
            if (cancelled) return;

            warnIfTargetObscured(target!, el);
            setPos(computeCursorPosition(container, el));

            if (showRipple) {
              clickTimerRef.current = setTimeout(() => {
                if (!cancelled) setBrowserClicking(true);
              }, CLICK_DELAY_MS);
            }
          });
        },
        didScroll ? SCROLL_SETTLE_MS : 0,
      );
    }

    const frame = requestAnimationFrame(tryFind);

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      clearTimeout(retryTimerRef.current);
      clearTimeout(settleTimerRef.current);
      clearTimeout(clickTimerRef.current);
    };
  }, [target, containerRef, showRipple]);

  useEffect(() => {
    return () => {
      clearTimeout(clickTimerRef.current);
      clearTimeout(retryTimerRef.current);
      clearTimeout(settleTimerRef.current);
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Recompute position when the container resizes (viewport change,
  // orientation flip, dynamic layout shift). Debounced to avoid jitter
  // from rapid resize events. Skipped in video-export mode where the
  // composition size is fixed.
  // ---------------------------------------------------------------------------
  const recomputeOnResize = useCallback(() => {
    const container = containerRef.current;
    if (!container || !target) return;
    const el = container.querySelector(
      `[data-cursor-target="${target}"]`,
    );
    if (!el) return;
    setPos(computeCursorPosition(container, el));
  }, [target, containerRef]);

  useEffect(() => {
    if (isVideoRef.current) return;
    const container = containerRef.current;
    if (!container || !target) return;

    let debounceTimer: ReturnType<typeof setTimeout>;
    const ro = new ResizeObserver(() => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(recomputeOnResize, RESIZE_DEBOUNCE_MS);
    });
    ro.observe(container);

    return () => {
      clearTimeout(debounceTimer);
      ro.disconnect();
    };
  }, [target, containerRef, recomputeOnResize]);

  return (
    <AnimatePresence>
      {pos && (
        <motion.div
          className="pointer-events-none absolute z-50"
          style={{ top: 0, left: 0 }}
          initial={{ x: pos.x, y: pos.y, opacity: 0 }}
          animate={{ x: pos.x, y: pos.y, opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={SPRING}
        >
          <CursorIcon />

          <AnimatePresence>
            {isClicking && (
              <motion.span
                key="ripple"
                className="absolute left-0 top-0 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary/50"
                initial={{ scale: 0.4, opacity: 0.9 }}
                animate={{ scale: 3, opacity: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.5, ease: "easeOut" }}
              />
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * Cursor-pointer icon. The tip of the arrow aligns with (0, 0)
 * so the parent's position maps directly to the click target.
 */
function CursorIcon() {
  return (
    <svg
      width="18"
      height="24"
      viewBox="0 0 12 16"
      fill="none"
      className="-translate-x-px -translate-y-px drop-shadow-sm"
      aria-hidden
    >
      <path
        d="M1 1v11.5l3-3 2.5 5.5 2-1-2.5-5.5H10L1 1Z"
        fill="hsl(var(--foreground) / 0.85)"
        stroke="hsl(var(--background))"
        strokeWidth="1"
        strokeLinejoin="round"
      />
    </svg>
  );
}
