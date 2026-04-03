"use client";

import { type RefObject, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

interface CursorProps {
  /**
   * Value of the `data-cursor-target` attribute on the element the
   * cursor should point at. When `undefined`, the cursor fades out.
   */
  target?: string;
  /** Container element used for relative position calculations. */
  containerRef: RefObject<HTMLDivElement | null>;
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

const CLICK_DELAY_MS = 450;
const RETRY_INTERVAL_MS = 80;
const MAX_RETRIES = 12;
const SCROLL_SETTLE_MS = 400;

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
function scrollTargetIntoView(el: Element): boolean {
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

function findScrollParent(el: Element): Element | null {
  let parent = el.parentElement;
  while (parent) {
    const { overflowY } = getComputedStyle(parent);
    if (overflowY === "auto" || overflowY === "scroll") return parent;
    parent = parent.parentElement;
  }
  return null;
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
export function Cursor({ target, containerRef }: CursorProps) {
  const [pos, setPos] = useState<Position | null>(null);
  const [clicking, setClicking] = useState(false);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    clearTimeout(clickTimerRef.current);
    clearTimeout(retryTimerRef.current);
    clearTimeout(settleTimerRef.current);
    setClicking(false);

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
        }
        return;
      }

      const didScroll = scrollTargetIntoView(el);

      settleTimerRef.current = setTimeout(
        () => {
          requestAnimationFrame(() => {
            if (cancelled) return;

            const cRect = container.getBoundingClientRect();
            const eRect = el.getBoundingClientRect();

            setPos({
              x: eRect.left - cRect.left + eRect.width / 2,
              y: eRect.top - cRect.top + eRect.height / 2,
            });

            clickTimerRef.current = setTimeout(() => {
              if (!cancelled) setClicking(true);
            }, CLICK_DELAY_MS);
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
  }, [target, containerRef]);

  useEffect(() => {
    return () => {
      clearTimeout(clickTimerRef.current);
      clearTimeout(retryTimerRef.current);
      clearTimeout(settleTimerRef.current);
    };
  }, []);

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
            {clicking && (
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
