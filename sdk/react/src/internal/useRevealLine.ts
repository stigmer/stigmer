"use client";

import { useCallback, useEffect, useRef, type RefObject } from "react";
import { prefersReducedMotion } from "./motion-preference.js";

/**
 * A transient request to scroll a line-faithful code view to a specific line
 * and emphasize it — the "reveal" seam behind jump-to-line navigation (e.g. a
 * content-search hit opening its file at the matched line).
 *
 * `line` is 1-based, matching the gutter and the grep's line numbers. `nonce`
 * is a monotonic token bumped by the producer on every navigation — including a
 * repeat navigation to the same `line` — so an already-mounted view re-scrolls
 * even when the target line is unchanged. The line is deliberately NOT part of
 * an editor's identity (see `WorkspaceEditorsStore`): it is navigation, not
 * state, so it must not key a remount.
 */
export interface RevealTarget {
  /** 1-based line to scroll to and highlight. */
  readonly line: number;
  /** Monotonic token; a change re-triggers the scroll (even for the same line). */
  readonly nonce: number;
}

/** Return value of {@link useRevealLine}. */
export interface UseRevealLineResult<T extends HTMLElement = HTMLElement> {
  /**
   * Attach to the element that wraps the addressable line rows. The hook scopes
   * its `[data-line]` query to this subtree, so multiple viewers never collide.
   */
  readonly containerRef: RefObject<T | null>;
  /** Whether a given 1-based line is the current reveal target (for the highlight). */
  readonly isRevealed: (line: number) => boolean;
}

/**
 * Scrolls a line-faithful code view to `reveal.line` and reports which line to
 * highlight.
 *
 * The mechanics are centralized here (rather than duplicated into each line
 * renderer) and mirror the established `data-attribute` scroll pattern used by
 * the workflow waterfall: the consumer renders each row with `data-line="N"`
 * and this hook, on every `reveal.nonce` change, finds the target row within
 * `containerRef` and scrolls it into view. Smooth scroll yields to
 * `prefers-reduced-motion` (a JS animation the CSS rule does not cover), and
 * the scroll is an optional call so it is a no-op under jsdom, which has no
 * `scrollIntoView`.
 *
 * Placement matters: mount this inside the line renderer, which exists only
 * after the file content has loaded — never above the async content gate — so
 * the `[data-line]` rows are present when the effect runs and a fresh open does
 * not race the load. A missing or out-of-range line is a silent no-op.
 */
export function useRevealLine<T extends HTMLElement = HTMLElement>(
  reveal: RevealTarget | undefined,
): UseRevealLineResult<T> {
  const containerRef = useRef<T | null>(null);

  useEffect(() => {
    if (!reveal) return;
    const container = containerRef.current;
    if (!container) return;

    const row = container.querySelector(`[data-line="${reveal.line}"]`);
    // Optional call: jsdom (tests) implements no `scrollIntoView`.
    row?.scrollIntoView?.({
      block: "center",
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
    // Intentionally keyed only on the nonce: a repeat navigation to the same
    // line (new nonce) must re-scroll, and `reveal.line` changes always ship a
    // new nonce, so it is covered transitively.
  }, [reveal?.nonce]);

  const isRevealed = useCallback(
    (line: number) => reveal?.line === line,
    [reveal?.line],
  );

  return { containerRef, isRevealed };
}
