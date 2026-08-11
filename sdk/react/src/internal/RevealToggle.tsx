"use client";

import { cn } from "@stigmer/theme";

/** Props for {@link RevealToggle}. */
export interface RevealToggleProps {
  /** Whether the governed content is currently fully revealed. */
  readonly expanded: boolean;
  /** Flips the reveal state. */
  readonly onToggle: () => void;
  /** Label shown while collapsed. Defaults to `"Show more"`. */
  readonly moreLabel?: string;
  /** Label shown while expanded. Defaults to `"Show less"`. */
  readonly lessLabel?: string;
  /** Stable hook for e2e/visual targeting (`data-cursor-target`). */
  readonly cursorTarget?: string;
  /** Additional CSS class names for the control. */
  readonly className?: string;
}

/**
 * The single "reveal more / less" control for every bounded block on the
 * execution surface — the diff/gate clamp ({@link BoundedContent}) and the
 * line-count text/terminal blocks ({@link CollapsiblePre} / {@link
 * CollapsibleCode}).
 *
 * It is the Cursor-style affordance the design calls for: a light, centered
 * chevron at the bottom-middle (down to reveal, up to collapse) with a quiet
 * label. Extracting it is what guarantees one disclosure *language* across two
 * truncation *mechanisms* (pixel clamp for visual blocks, line count for text)
 * — the surfaces can never visually drift because they render the same control.
 *
 * Presentational only: it owns no state. The caller holds the reveal state and
 * passes `expanded` + `onToggle`. It carries `aria-expanded` for the block it
 * governs; the owning tool-call row's header chevron (when present) carries the
 * row-level disclosure, so the two axes never collide.
 *
 * @internal Not part of the public API.
 */
export function RevealToggle({
  expanded,
  onToggle,
  moreLabel = "Show more",
  lessLabel = "Show less",
  cursorTarget,
  className,
}: RevealToggleProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      data-cursor-target={cursorTarget}
      className={cn(
        "stg:mt-1 stg:flex stg:w-full stg:items-center stg:justify-center stg:gap-1 stg:rounded stg:py-0.5",
        "stg:text-xs stg:font-medium stg:text-muted-foreground stg:transition-colors stg:hover:text-foreground",
        "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
        className,
      )}
    >
      <span>{expanded ? lessLabel : moreLabel}</span>
      <ChevronIcon expanded={expanded} />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Inline SVG icon
// ---------------------------------------------------------------------------

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn(
        "stg:shrink-0 stg:transition-transform stg:duration-150",
        expanded && "stg:rotate-180",
      )}
      aria-hidden="true"
    >
      <path d="M2.5 3.5L5 6.5L7.5 3.5" />
    </svg>
  );
}
