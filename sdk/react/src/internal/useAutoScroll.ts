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
  /** Attach to the scrollable container. */
  readonly scrollRef: React.RefObject<HTMLDivElement | null>;
  /** Attach to a zero-height div as the last child of the scroll container. */
  readonly sentinelRef: React.RefObject<HTMLDivElement | null>;
  /** Attach to a wrapper div around the thread content (ResizeObserver target). */
  readonly contentRef: React.RefObject<HTMLDivElement | null>;
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
 * @internal Not part of the public API.
 */
export function useAutoScroll(): UseAutoScrollReturn {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

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
  useEffect(() => {
    const content = contentRef.current;
    if (!content || !scrollRef.current) return;

    const ro = new ResizeObserver(() => {
      if (!isFollowingRef.current) return;
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = requestAnimationFrame(() => {
        const el = scrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      });
    });

    ro.observe(content);

    return () => {
      ro.disconnect();
      cancelAnimationFrame(rafIdRef.current);
    };
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
