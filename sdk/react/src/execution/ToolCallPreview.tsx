"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { ToolResultView } from "@stigmer/sdk";
import { cn } from "@stigmer/theme";
import { ResultView } from "./ResultView";

/** Props for {@link ToolCallPreview}. */
export interface ToolCallPreviewProps {
  /** The normalized result to preview (from `normalizeToolResult`). */
  readonly result: ToolResultView;
  /**
   * Promotes the preview to the full {@link ToolCallDetail}. Wired to the
   * owning row's existing disclosure toggle, so the row stays the single
   * source of expansion state (no competing `aria-expanded`).
   */
  readonly onShowMore: () => void;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Maximum height of a settled preview before it clamps. Tall enough to show a
 * screenshot or a handful of output lines at a glance, short enough that a turn
 * of several previewed rows still scans as a timeline rather than a wall.
 */
const PREVIEW_MAX_HEIGHT = "max-h-48";

/**
 * Tier 2 of the tool-call disclosure model: a **bounded, persistent** preview
 * of a settled tool result that stays visible in the timeline instead of
 * collapsing away.
 *
 * It leads with the *result* — the {@link ResultView} that {@link
 * ToolCallDetail} also uses — because for `preview` categories the result IS
 * the information (a shell command's output, an MCP screenshot, a fetched page).
 * `normalizeToolResult` already folds an offloaded image/output-ref into a
 * `ResultView`-renderable shape, so a screenshot surfaces here directly rather
 * than being buried under args. Arguments and metadata are intentionally
 * deferred to the full detail (Tier 3), reached via "Show more" — which simply
 * drives the row's own toggle, keeping one disclosure control per row.
 *
 * The body is height-clamped with a bottom fade (only when it actually
 * overflows), mirroring the gradient affordance used elsewhere in the console.
 *
 * @example
 * ```tsx
 * <ToolCallPreview result={result} onShowMore={toggleRow} />
 * ```
 */
export function ToolCallPreview({
  result,
  onShowMore,
  className,
}: ToolCallPreviewProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [isClamped, setIsClamped] = useState(false);

  // Show the fade only when the result actually exceeds the clamp. Settled
  // previews have stable content, so a post-render measure is sufficient (and
  // degrades to "no fade" under jsdom, where layout is not computed).
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    setIsClamped(el.scrollHeight > el.clientHeight + 1);
  });

  // Nothing to preview (e.g. a shell command that produced no output) — the
  // compact row already tells the whole story.
  if (result.type === "empty") return null;

  return (
    <div
      className={cn("px-2.5 pb-2 pt-1", className)}
      data-cursor-target="tool-preview"
    >
      <div className={cn("relative overflow-hidden", PREVIEW_MAX_HEIGHT)} ref={bodyRef}>
        <ResultView view={result} />
        {isClamped && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-background to-transparent"
          />
        )}
      </div>
      <button
        type="button"
        onClick={onShowMore}
        data-cursor-target="tool-preview-expand"
        className="mt-1 text-xs font-medium text-primary transition-colors hover:text-primary-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
      >
        Show more
      </button>
    </div>
  );
}
