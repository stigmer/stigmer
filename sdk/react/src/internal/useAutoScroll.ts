"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Near-bottom tolerance in pixels. The sentinel is considered visible
 * (and follow mode stays engaged) when the user is within this distance
 * of the bottom. Matches the threshold used by the previous scroll
 * implementation.
 */
const NEAR_BOTTOM_MARGIN_PX = 80;

export interface UseAutoScrollReturn {
  /** Attach to the scrollable container. Must be mounted from the first render. */
  readonly scrollRef: React.RefObject<HTMLDivElement | null>;
  /**
   * Attach to a zero-height div as the last child of the scroll container.
   * Must be mounted from the first render.
   */
  readonly sentinelRef: React.RefObject<HTMLDivElement | null>;
  /**
   * Attach to a wrapper div around the thread content (ResizeObserver
   * target). MAY mount late or round-trip through unmount — a callback
   * ref, so consumers whose content sits inside a loading branch (the
   * conversation timeline) are observed the moment the wrapper appears.
   */
  readonly contentRef: React.RefCallback<HTMLDivElement>;
  /** True when the thread auto-scrolls to follow new content. */
  readonly isFollowing: boolean;
  /** Scroll to the latest content and re-engage follow mode. */
  readonly jumpToLatest: () => void;
}

/**
 * Two-state auto-scroll state machine for chat threads.
 *
 * **Following** — content is pinned to the bottom; new content
 * (streaming tokens, new messages, tool panel expansion) triggers a
 * `requestAnimationFrame`-batched scroll-to-bottom.
 *
 * **Disengaged** — the user scrolled away from the bottom; no
 * automatic scrolling occurs. Call {@link UseAutoScrollReturn.jumpToLatest}
 * to re-engage.
 *
 * State transitions are driven by an `IntersectionObserver` on a
 * bottom sentinel element. A `ResizeObserver` on the content wrapper
 * detects height growth and triggers rAF-batched scroll writes when
 * in the Following state.
 *
 * Ref contract (asymmetric on purpose): the scroller and sentinel must
 * exist from the first render — every thread renders its scroll pane
 * unconditionally, and the observers that need them attach once at
 * mount. The CONTENT wrapper may appear later or round-trip through
 * unmount: chat threads legitimately render a loading skeleton first
 * (the conversation timeline does), so `contentRef` is a callback ref
 * that owns the ResizeObserver's lifecycle — React hands it the node on
 * attach and `null` on detach, so the observer follows the wrapper
 * wherever it goes, with no render cost. Attaching only at mount
 * shipped channel-conversations F-09: a late-mounting wrapper was never
 * observed, so every conversation opened at its oldest message and
 * nothing ever scrolled the view.
 *
 * @internal Not part of the public API.
 */
export function useAutoScroll(): UseAutoScrollReturn {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const [isFollowing, setIsFollowing] = useState(true);
  const isFollowingRef = useRef(true);
  const rafIdRef = useRef(0);
  // The last scrollTop THIS HOOK wrote (mount pin, rAF growth writes,
  // jumpToLatest). The reader-vs-growth discriminator for the observer
  // callbacks: content growth never moves scrollTop — only the reader
  // does — so "not near bottom" while scrollTop still sits exactly on the
  // system's own last write means content grew under a pin, not that the
  // reader escaped.
  const lastSystemScrollTopRef = useRef<number | null>(null);

  // Keep ref in sync with state so observer callbacks read the latest
  // value without re-subscribing on every state change.
  useEffect(() => {
    isFollowingRef.current = isFollowing;
  }, [isFollowing]);

  // --- IntersectionObserver: sentinel visibility drives state ---
  useEffect(() => {
    const sentinel = sentinelRef.current;
    const scroller = scrollRef.current;
    if (!sentinel || !scroller) return;

    // Establish initial position at the bottom so the first IO
    // callback sees the sentinel as intersecting.
    scroller.scrollTop = scroller.scrollHeight;
    lastSystemScrollTopRef.current = scroller.scrollTop;

    const io = new IntersectionObserver(
      () => {
        // The delivery is the signal; the LIVE geometry is the truth.
        // An entry snapshots geometry at OBSERVATION time and can be
        // delivered after the reader has scrolled again — measured in
        // the F-09 net: a stale "visible" (captured at the pinned
        // instant) landed after a scroll-up, re-engaged follow, and the
        // next growth yanked the reader to the bottom. Measuring at
        // delivery time keeps the observer as a poll-free change
        // detector without trusting its stale payload.
        const el = scrollRef.current;
        if (!el) return;
        const visible =
          el.scrollHeight - el.scrollTop - el.clientHeight <=
          NEAR_BOTTOM_MARGIN_PX;
        // The growth-vs-reader discriminator (the write-time guard's
        // mirror, found via the stigmer-cloud#267 pin-on-send suite): a
        // delivery can measure geometry where content ALREADY grew below
        // a system pin but the pin's ResizeObserver write has not run
        // yet. Measured live that reads "not visible" — yet the reader
        // never moved (scrollTop still sits exactly on the system's own
        // last write). Disengaging here would make the imminent RO
        // callback drop its write and strand the thread one row shy of
        // the bottom with follow off. Only the READER may disengage.
        if (!visible && el.scrollTop === lastSystemScrollTopRef.current) {
          return;
        }
        isFollowingRef.current = visible;
        setIsFollowing(visible);
      },
      {
        root: scroller,
        rootMargin: `0px 0px ${NEAR_BOTTOM_MARGIN_PX}px 0px`,
        threshold: 0,
      },
    );

    io.observe(sentinel);
    return () => io.disconnect();
  }, []);

  // --- ResizeObserver: scroll on content height growth while following ---
  // Lifecycle lives in the callback ref (not a run-once effect): the
  // observer must adopt a wrapper that mounts after a loading branch and
  // let go of one that unmounts — including on component unmount, where
  // React also calls the ref with null. Its initial delivery on observe()
  // doubles as the first-fill bottom pin. The scroller is read lazily at
  // fire time (deliveries are async, after every commit's refs are set).
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const contentRef = useCallback((node: HTMLDivElement | null) => {
    resizeObserverRef.current?.disconnect();
    resizeObserverRef.current = null;
    cancelAnimationFrame(rafIdRef.current);
    if (!node) return;

    const ro = new ResizeObserver(() => {
      if (!isFollowingRef.current) return;
      cancelAnimationFrame(rafIdRef.current);
      // The reader-took-control guard, decided at WRITE time: a frame
      // can lag (headless and busy tabs throttle rAF) long enough for
      // the reader to scroll up between scheduling and writing, and a
      // stale pin then yanks them back to the bottom (the F-09 suite's
      // scrolled-up case, flaking ~1-in-5 under real Chromium). The
      // discriminator is scrollTop itself: content growth never moves
      // it, only the reader does — `isFollowingRef` cannot arbitrate
      // here because growth makes the sentinel leave the viewport
      // transiently, so the flag reads false mid-pin by design.
      const scheduledAt = scrollRef.current?.scrollTop ?? null;
      rafIdRef.current = requestAnimationFrame(() => {
        const el = scrollRef.current;
        if (!el) return;
        if (scheduledAt !== null && el.scrollTop !== scheduledAt) return;
        el.scrollTop = el.scrollHeight;
        lastSystemScrollTopRef.current = el.scrollTop;
      });
    });
    ro.observe(node);
    resizeObserverRef.current = ro;
  }, []);

  const jumpToLatest = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    lastSystemScrollTopRef.current = el.scrollTop;
    // Eagerly set following — IO callback will confirm when the
    // sentinel becomes visible after the scroll.
    isFollowingRef.current = true;
    setIsFollowing(true);
  }, []);

  return { scrollRef, sentinelRef, contentRef, isFollowing, jumpToLatest };
}

/**
 * Pins the thread to its latest content whenever `signal` changes — the
 * scroll-on-send idiom (stigmer-cloud#267): each surface increments a
 * monotonic counter at its own "the reader sent something" moment (an
 * optimistic message appearing, a conversation reply dispatched, a HITL
 * decision submitted), and the pin re-engages follow mode so the resulting
 * content lands in view even for a reader who had deliberately scrolled up.
 * WhatsApp convention: showing the result of the reader's OWN action is
 * Nielsen #1 system-status feedback — distinct from INCOMING content, which
 * must never move a scrolled-up reader (the F-09 posture, unchanged).
 *
 * <p>No pin fires on mount, on an `undefined` signal (surface opted out or
 * prop not wired), or on the `undefined`→number transition (a prop
 * appearing is not a send).
 *
 * @internal Not part of the public API.
 */
export function usePinToLatestOnSignal(
  signal: number | undefined,
  pinToLatest: () => void,
): void {
  const previousRef = useRef(signal);
  useEffect(() => {
    const previous = previousRef.current;
    previousRef.current = signal;
    if (signal === undefined || previous === undefined || signal === previous) {
      return;
    }
    pinToLatest();
  }, [signal, pinToLatest]);
}
