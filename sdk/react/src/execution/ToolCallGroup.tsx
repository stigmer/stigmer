"use client";

import { memo, useMemo } from "react";
import type { ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { SubAgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/subagent_pb";
import { cn } from "@stigmer/theme";
import { useRenderTracer } from "../internal/dev/index.js";
import { ToolCallItem } from "./ToolCallItem.js";
import { ToolRunGroup } from "./ToolRunGroup.js";
import { segmentToolCalls } from "./segment-tool-calls.js";
import { isCollapsedToolCall } from "./tool-categories.js";

/** Props for {@link ToolCallGroup}. */
export interface ToolCallGroupProps {
  /** Tool calls in this group, ordered by invocation time. */
  readonly toolCalls: readonly ToolCall[];
  /**
   * Sub-agent executions from the parent `AgentExecutionStatus`.
   * When provided, tool calls whose `id` matches a
   * `SubAgentExecution.id` are rendered with a nested sub-agent
   * thread instead of a standard detail panel.
   */
  readonly subAgentExecutions?: readonly SubAgentExecution[];
  /**
   * Custom label formatter for a folded run chip (e.g. a run of reads).
   * Receives the run's tool calls and returns the chip's collapsed label.
   *
   * NOTE: the unit of summary moved from the *turn* to the *run*. This used to
   * label the whole turn ("Ran 3 tools"); since the turn no longer collapses,
   * it now labels each {@link ToolRunGroup} chip. The signature is unchanged.
   */
  readonly formatSummary?: (toolCalls: readonly ToolCall[]) => string;
  /**
   * @deprecated No-op. The turn no longer collapses as a unit — rows persist
   * and only repetitive runs fold (see {@link ToolRunGroup}). Kept for
   * back-compat so existing call sites keep type-checking.
   */
  readonly defaultExpanded?: boolean;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Shallow comparison for `ToolCallGroupProps`.
 *
 * The `toolCalls` array may be a newly allocated subset (e.g.
 * `buildThreadItems` filters out `task` calls). Structural sharing
 * (T04) keeps individual `ToolCall` objects stable, so we compare
 * array elements by reference rather than the array itself.
 *
 * @internal Exported for testing — not part of the public API.
 */
export function toolCallGroupPropsEqual(
  prev: Readonly<ToolCallGroupProps>,
  next: Readonly<ToolCallGroupProps>,
): boolean {
  if (prev.toolCalls.length !== next.toolCalls.length) return false;
  for (let i = 0; i < prev.toolCalls.length; i++) {
    if (prev.toolCalls[i] !== next.toolCalls[i]) return false;
  }
  return (
    prev.subAgentExecutions === next.subAgentExecutions &&
    prev.formatSummary === next.formatSummary &&
    prev.defaultExpanded === next.defaultExpanded &&
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
 * - high-signal calls (edits, shell, MCP, sub-agents, …) render as persistent
 *   {@link ToolCallItem} rows; a content-bearing call shows its body inline
 *   (no card chevron), bounded by a single in-place reveal;
 * - runs of consecutive low-signal same-category calls (read / list / search)
 *   fold into one collapsible {@link ToolRunGroup} chip — the *only* collapse,
 *   because that is the only genuine noise.
 *
 * The rows are clustered under a light left rail (the neutral counterpart to
 * {@link SubAgentSection}'s primary-tinted rail for delegated work), keeping a
 * turn's tools visually associated with their AI message without a tab that
 * hides things.
 *
 * Wrapped in `React.memo` with a custom comparator that checks `toolCalls`
 * elements by reference (structural sharing keeps individual `ToolCall` objects
 * stable for unchanged calls), so settled rows skip re-renders while siblings
 * stream (DD-009/010).
 *
 * @example
 * ```tsx
 * <ToolCallGroup toolCalls={message.toolCalls} />
 * ```
 */
export const ToolCallGroup = memo(function ToolCallGroup({
  toolCalls,
  subAgentExecutions,
  formatSummary,
  className,
}: ToolCallGroupProps) {
  useRenderTracer("ToolCallGroup", { toolCallCount: toolCalls.length });

  // Drop runner-collapsed duplicates (a superseded same-turn denial twin of an
  // approval gate) so one gated resource renders one card, not two. The blanked
  // twin is kept in the persisted transcript (the backend's append-only guard
  // forbids dropping it); it is simply not drawn.
  const visibleToolCalls = useMemo(
    () => toolCalls.filter((tc) => !isCollapsedToolCall(tc)),
    [toolCalls],
  );

  const segments = useMemo(
    () => segmentToolCalls(visibleToolCalls),
    [visibleToolCalls],
  );

  const subAgentMap = useMemo(() => {
    if (!subAgentExecutions || subAgentExecutions.length === 0) return null;
    const map = new Map<string, SubAgentExecution>();
    for (const sub of subAgentExecutions) {
      map.set(sub.id, sub);
    }
    return map;
  }, [subAgentExecutions]);

  if (visibleToolCalls.length === 0) return null;

  const ariaLabel = `${visibleToolCalls.length} tool ${visibleToolCalls.length === 1 ? "call" : "calls"}`;

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
            toolCalls={segment.toolCalls}
            formatLabel={formatSummary}
          />
        ) : (
          <ToolCallItem
            key={segment.key}
            toolCall={segment.toolCall}
            subAgentExecution={subAgentMap?.get(segment.toolCall.id) ?? null}
          />
        ),
      )}
    </div>
  );
}, toolCallGroupPropsEqual);
