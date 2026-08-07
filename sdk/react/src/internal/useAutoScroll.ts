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

    const io = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        const visible = entry.isIntersecting;
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
      rafIdRef.current = requestAnimationFrame(() => {
        const el = scrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      });
    });
    ro.observe(node);
    resizeObserverRef.current = ro;
  }, []);

  const jumpToLatest = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    // Eagerly set following — IO callback will confirm when the
    // sentinel becomes visible after the scroll.
    isFollowingRef.current = true;
    setIsFollowing(true);
  }, []);

  return { scrollRef, sentinelRef, contentRef, isFollowing, jumpToLatest };
}
