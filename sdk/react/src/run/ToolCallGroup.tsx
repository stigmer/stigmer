"use client";

import { memo, useMemo } from "react";
import type { ToolUse } from "@stigmer/client";
import { cn } from "@stigmer/design-tokens";
import { useRenderTracer } from "../internal/dev/index.js";
import { ToolCallItem } from "./ToolCallItem.js";
import { ToolRunGroup } from "./ToolRunGroup.js";
import { segmentToolCalls } from "./segment-tool-calls.js";

/** Props for {@link ToolCallGroup}. */
export interface ToolCallGroupProps {
  /**
   * Tool uses in this group, in the order the agent made them. A tool use
   * that started a subagent renders its nested thread instead of a
   * standard detail panel.
   */
  readonly toolUses: readonly ToolUse[];
  /**
   * Custom label formatter for a folded run chip (e.g. a run of reads).
   * Receives the run's tool uses and returns the chip's collapsed label.
   *
   * The unit of summary is the *run*, not the turn: the turn does not
   * collapse, so this labels each {@link ToolRunGroup} chip.
   */
  readonly formatSummary?: (toolUses: readonly ToolUse[]) => string;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Shallow comparison for `ToolCallGroupProps`.
 *
 * The `toolUses` array is newly allocated by each thread build; the session
 * fold keeps unchanged `ToolUse` objects stable, so we compare array
 * elements by reference rather than the array itself.
 *
 * @internal Exported for testing — not part of the public API.
 */
export function toolCallGroupPropsEqual(
  prev: Readonly<ToolCallGroupProps>,
  next: Readonly<ToolCallGroupProps>,
): boolean {
  if (prev.toolUses.length !== next.toolUses.length) return false;
  for (let i = 0; i < prev.toolUses.length; i++) {
    if (prev.toolUses[i] !== next.toolUses[i]) return false;
  }
  return (
    prev.formatSummary === next.formatSummary &&
    prev.className === next.className
  );
}

/**
 * Renders one AI turn's tool activity as a **persistent-row timeline** rather
 * than a collapsible "Ran N tools" box. Each call stays visible after it
 * settles, so completed work is never hidden behind a pill — the thread reads
 * like a virtual human at work.
 *
 * The turn is segmented by {@link segmentToolCalls}:
 * - high-signal calls (edits, shell, MCP, subagents, …) render as persistent
 *   {@link ToolCallItem} rows; a content-bearing call shows its body inline
 *   (no card chevron), bounded by a single in-place reveal;
 * - runs of consecutive low-signal same-category calls (read / list / search)
 *   fold into one collapsible {@link ToolRunGroup} chip — the *only* collapse,
 *   because that is the only genuine noise.
 *
 * The rows are clustered under a light left rail (the neutral counterpart to
 * {@link SubagentSection}'s primary-tinted rail for delegated work), keeping a
 * turn's tools visually associated with their agent message without a tab that
 * hides things.
 *
 * Wrapped in `React.memo` with a custom comparator that checks `toolUses`
 * elements by reference (the session fold keeps unchanged `ToolUse` objects
 * stable), so settled rows skip re-renders while siblings stream.
 *
 * @example
 * ```tsx
 * <ToolCallGroup toolUses={toolUses} />
 * ```
 */
export const ToolCallGroup = memo(function ToolCallGroup({
  toolUses,
  formatSummary,
  className,
}: ToolCallGroupProps) {
  useRenderTracer("ToolCallGroup", { toolCallCount: toolUses.length });

  const segments = useMemo(() => segmentToolCalls(toolUses), [toolUses]);

  if (toolUses.length === 0) return null;

  const ariaLabel = `${toolUses.length} tool ${toolUses.length === 1 ? "call" : "calls"}`;

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      data-cursor-target="tool-call-group"
      className={cn(
        // Cursor-style: each tool call (and folded run chip) is its own
        // self-contained card; the turn's tools stack with a small gap between
        // them rather than sharing a left rail, so the thread reads as a column
        // of discrete cards.
        "stg:flex stg:flex-col stg:gap-2",
        className,
      )}
    >
      {segments.map((segment) =>
        segment.kind === "run" ? (
          <ToolRunGroup
            key={segment.key}
            category={segment.category}
            toolUses={segment.toolUses}
            formatLabel={formatSummary}
          />
        ) : (
          <ToolCallItem key={segment.key} toolUse={segment.toolUse} />
        ),
      )}
    </div>
  );
}, toolCallGroupPropsEqual);
