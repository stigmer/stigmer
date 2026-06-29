"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { cn } from "@stigmer/theme";
import { useIsOverflowing } from "./useIsOverflowing";
import { RevealToggle } from "./RevealToggle";

/**
 * The single shared height budget for a bounded tool-card block. Tall enough
 * to show a screenshot or a handful of diff lines at a glance, short enough
 * that a turn of several cards still scans as a timeline rather than a wall.
 * One constant so the settled edit/write diff and the HITL approval gate diff
 * are visually identical — change it here to retune both at once.
 */
export const PREVIEW_MAX_HEIGHT = "max-h-48";

/** Props for {@link BoundedContent}. */
export interface BoundedContentProps {
  /** The content to bound — a diff (the only consumer today). */
  readonly children: ReactNode;
  /**
   * Tailwind `max-h-*` clamp applied while collapsed. Defaults to the shared
   * {@link PREVIEW_MAX_HEIGHT} budget; override only with deliberate reason.
   */
  readonly maxHeightClass?: string;
  /** Stable hook for e2e/visual targeting on the reveal control. */
  readonly cursorTarget?: string;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Bounds a visual block to one shared height budget with a bottom fade and an
 * in-place {@link RevealToggle} — the "clamp + fade + Show more" shape used by
 * the settled edit/write diff and the approval gate diff.
 *
 * This is the **pixel-clamp** truncation mechanism, for content that has no
 * internal cap of its own (a diff table). Text and terminal output instead use
 * the **line-count** mechanism ({@link CollapsiblePre} / {@link
 * CollapsibleCode}); both render the same {@link RevealToggle}, so the two
 * mechanisms share one visual language without ever double-bounding the same
 * block. Never wrap content that already self-truncates in this.
 *
 * The control and fade appear only when {@link useIsOverflowing} reports the
 * content is actually clipped (or the user expanded it). The fade uses
 * `from-background`, matching every surface that consumes this today; a surface
 * on a different token must supply its own fade.
 *
 * @internal Not part of the public API.
 *
 * @example
 * ```tsx
 * <BoundedContent><FileChangeDiff change={change} /></BoundedContent>
 * ```
 */
export function BoundedContent({
  children,
  maxHeightClass = PREVIEW_MAX_HEIGHT,
  cursorTarget,
  className,
}: BoundedContentProps) {
  const [expanded, setExpanded] = useState(false);

  // The clamp is applied while collapsed; measurement is only meaningful then.
  const clamped = !expanded;
  const { ref, isOverflowing } = useIsOverflowing<HTMLDivElement>(clamped);

  // The control appears only when there is something hidden — either the
  // content overflows now, or it was expanded (so "Show less" stays reachable).
  const showControl = isOverflowing || expanded;
  const showFade = clamped && isOverflowing;

  return (
    <div className={className}>
      <div
        ref={ref}
        className={cn("relative overflow-hidden", clamped && maxHeightClass)}
      >
        {children}
        {showFade && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-background to-transparent"
          />
        )}
      </div>
      {showControl && (
        <RevealToggle
          expanded={expanded}
          onToggle={() => setExpanded((v) => !v)}
          cursorTarget={cursorTarget}
        />
      )}
    </div>
  );
}
