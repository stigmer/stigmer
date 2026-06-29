"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { cn } from "@stigmer/theme";
import { useIsOverflowing } from "./useIsOverflowing";

/**
 * The single shared height budget for a bounded tool-card preview. Tall enough
 * to show a screenshot or a handful of diff/output lines at a glance, short
 * enough that a turn of several previewed rows still scans as a timeline rather
 * than a wall. One constant so the settled preview, the expanded edit detail,
 * and the HITL approval gate are visually identical — change it here to retune
 * every surface at once.
 */
export const PREVIEW_MAX_HEIGHT = "max-h-48";

/** Props for {@link BoundedContent}. */
export interface BoundedContentProps {
  /** The content to bound — a diff, terminal, code block, image, etc. */
  readonly children: ReactNode;
  /**
   * Tailwind `max-h-*` clamp applied while collapsed. Defaults to the shared
   * {@link PREVIEW_MAX_HEIGHT} budget; override only with deliberate reason.
   */
  readonly maxHeightClass?: string;
  /**
   * When provided, the reveal control *delegates* to this callback instead of
   * expanding the clamp in place — used where there is a richer surface to
   * promote to (e.g. a settled {@link ToolCallPreview} row whose "Show more"
   * opens the full {@link ToolCallDetail}). In delegated mode the control is
   * always shown (the fuller view is always available) and the body stays
   * clamped. When omitted (the default), the control expands the content in
   * place: "Show more" removes the clamp, "Show less" restores it, and the
   * control appears only when the content actually overflows the budget.
   */
  readonly onExpand?: () => void;
  /** Stable hook for e2e/visual targeting on the reveal control. */
  readonly cursorTarget?: string;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Bounds any content body to one shared height budget with a bottom fade and a
 * reveal control — the single source of the "clamp + fade + Show more" shape
 * that the tool-call timeline preview, the expanded detail, and the approval
 * gate all share.
 *
 * It has two reveal modes (see {@link BoundedContentProps.onExpand}): *in-place*
 * (default — toggles the clamp on this content) and *delegated* (promotes to a
 * fuller surface). Both keep one clamp value, one fade, and one measurement so
 * the surfaces can never visually drift.
 *
 * The fade is only rendered when {@link useIsOverflowing} reports the content
 * is actually clipped; it uses `from-background`, which matches every surface
 * that consumes this today (all sit on the card background). A surface on a
 * different token must supply its own fade rather than relying on this default.
 *
 * @internal Not part of the public API.
 *
 * @example
 * ```tsx
 * // In place (gate, edit detail): Show more removes the clamp.
 * <BoundedContent><FileDiff .../></BoundedContent>
 *
 * // Delegated (settled preview): Show more opens the full detail.
 * <BoundedContent onExpand={openDetail}><ResultView .../></BoundedContent>
 * ```
 */
export function BoundedContent({
  children,
  maxHeightClass = PREVIEW_MAX_HEIGHT,
  onExpand,
  cursorTarget,
  className,
}: BoundedContentProps) {
  const delegated = onExpand != null;
  const [expanded, setExpanded] = useState(false);

  // The clamp is applied while collapsed (delegated mode never expands in place,
  // so it is always clamped). Measurement is only meaningful while clamped.
  const clamped = delegated || !expanded;
  const { ref, isOverflowing } = useIsOverflowing<HTMLDivElement>(clamped);

  // Delegated: the fuller view is always reachable, so the control is always
  // shown (mirrors the settled preview's always-available "Show more"). In
  // place: the control appears only when there is something hidden — either the
  // content overflows now, or it was expanded (so "Show less" stays reachable).
  const showControl = delegated || isOverflowing || expanded;
  const showFade = clamped && isOverflowing;

  const handleClick = () => {
    if (delegated) {
      onExpand();
      return;
    }
    setExpanded((v) => !v);
  };

  const controlLabel = delegated ? "Show more" : expanded ? "Show less" : "Show more";

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
        <button
          type="button"
          onClick={handleClick}
          data-cursor-target={cursorTarget}
          // aria-expanded only in place, where this control owns the visible
          // disclosure; in delegated mode the owning row's chevron carries it,
          // so a second aria-expanded here would be a duplicate control.
          aria-expanded={delegated ? undefined : expanded}
          className="mt-1 rounded text-xs font-medium text-primary transition-colors hover:text-primary-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {controlLabel}
        </button>
      )}
    </div>
  );
}
