"use client";

import type { ToolResultView } from "@stigmer/sdk";
import { cn } from "@stigmer/theme";
import { BoundedContent } from "../internal/BoundedContent";
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
 * The body is bounded (and faded when it overflows) by the shared {@link
 * BoundedContent} primitive, used here in *delegated* mode: "Show more" promotes
 * to the full detail rather than expanding in place, because for these
 * categories the detail adds genuinely more (the args the preview omits). The
 * same primitive bounds the expanded edit detail and the approval gate, so all
 * three share one height budget and one fade.
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
  // Nothing to preview (e.g. a shell command that produced no output) — the
  // compact row already tells the whole story.
  if (result.type === "empty") return null;

  return (
    <div
      className={cn("px-2.5 pb-2 pt-1", className)}
      data-cursor-target="tool-preview"
    >
      <BoundedContent onExpand={onShowMore} cursorTarget="tool-preview-expand">
        {/* The owning tool-call row already names the file and shows +N -M for
            edits, so the previewed diff/file body suppresses both its path and
            its stats — leaving just the content. */}
        <ResultView view={result} showFileName={false} showStats={false} />
      </BoundedContent>
    </div>
  );
}
