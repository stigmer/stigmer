"use client";

import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import { CATEGORY_COLORS } from "./canvas-constants";
import type { CanvasTaskNodeData } from "./workflow-graph-conversions";
import { getVisualSpec } from "./task-type-visual-registry";
import { NodeShell, NodeContent, NodeHandles, NodeActions } from "./node-shell";

const NESTED_TASK_KINDS = new Set(["fork", "for_each", "try_catch"]);

/**
 * Unified workflow node component for the React Flow canvas.
 *
 * Composes four single-responsibility sub-components:
 * - `NodeShell` — visual shape boundary (CSS or SVG based on visual class)
 * - `NodeContent` — task name + kind badge
 * - `NodeHandles` — connection ports driven by the visual registry
 * - `NodeActions` — design-mode interaction affordances (toolbar, picker)
 *
 * This replaces `CanvasTaskNode` with proper shape differentiation per
 * task kind. The component preserves all existing `data-*` attributes
 * and ARIA labels for E2E test and accessibility compatibility.
 */
export const WorkflowNode = memo(function WorkflowNode({
  id,
  data,
  selected,
}: NodeProps & { data: CanvasTaskNodeData }) {
  const visualSpec = getVisualSpec(data.isSentinel ? id : data.kindString);
  const categoryColor = CATEGORY_COLORS[data.category];
  const errorCount = data.errorCount ?? 0;
  const isNested = NESTED_TASK_KINDS.has(data.kindString);

  return (
    <div
      data-visual-class={data.visualClass}
      data-task-kind={data.kindString}
      aria-label={buildAriaLabel(data, errorCount)}
    >
      <NodeShell
        visualClass={visualSpec.visualClass}
        width={visualSpec.defaultWidth}
        height={visualSpec.defaultHeight}
        categoryColor={categoryColor}
        selected={selected}
        errorCount={errorCount}
      >
        <NodeContent
          visualClass={visualSpec.visualClass}
          taskName={data.taskName}
          displayName={data.displayName}
          categoryColor={categoryColor}
          isNested={isNested}
        />
      </NodeShell>

      {errorCount > 0 && (
        <span
          className="absolute -right-1.5 -top-1.5 z-20 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--stgm-destructive,#ef4444)] px-1 text-[9px] font-bold leading-none text-white"
          title={`${errorCount} validation ${errorCount === 1 ? "error" : "errors"}`}
        >
          {errorCount}
        </span>
      )}

      <NodeHandles portPattern={visualSpec.portPattern} data={data} />

      {!data.isSentinel && (
        <NodeActions nodeId={id} taskName={data.taskName} />
      )}
    </div>
  );
});

function buildAriaLabel(data: CanvasTaskNodeData, errorCount: number): string {
  const base = `${data.displayName} node ${data.taskName}, ${data.ariaShapeLabel} shape`;
  if (errorCount > 0) {
    return `${base}, ${errorCount} ${errorCount === 1 ? "error" : "errors"}`;
  }
  return base;
}
