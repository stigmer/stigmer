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
  /**
   * Whether the steps draw their own card. Defaults to `true`; `false` when
   * the group sits inside a container that already frames it (a folded
   * stretch, a plan's to-do), so a card is never drawn inside a card.
   */
  readonly framed?: boolean;
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
    prev.framed === next.framed &&
    prev.className === next.className
  );
}

/**
 * Renders a run of a turn's steps as one list: a card of one-line steps,
 * each closed until clicked and opening in place to what it did (see
 * {@link ToolCallItem}).
 *
 * The run is segmented by {@link segmentToolCalls}: consecutive reads,
 * listings and searches fold into one {@link ToolRunGroup} line ("Read 3
 * files") that opens to each; every other call is its own step.
 *
 * Wrapped in `React.memo` with a custom comparator that checks `toolUses`
 * elements by reference (the session fold keeps unchanged `ToolUse` objects
 * stable), so settled rows skip re-renders while siblings stream.
 *
 * @example
 * ```tsx
 * import type { ToolUse } from "@stigmer/client";
 *
 * function Steps({ toolUses }: { toolUses: readonly ToolUse[] }) {
 *   return <ToolCallGroup toolUses={toolUses} />;
 * }
 * ```
 */
export const ToolCallGroup = memo(function ToolCallGroup({
  toolUses,
  formatSummary,
  framed = true,
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
        framed && "stg:overflow-hidden stg:rounded-lg stg:border stg:border-border stg:bg-card",
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
            className="stg:border-b stg:border-border-muted stg:last:border-b-0"
          />
        ) : (
          <ToolCallItem key={segment.key} toolUse={segment.toolUse} bordered={false} />
        ),
      )}
    </div>
  );
}, toolCallGroupPropsEqual);
