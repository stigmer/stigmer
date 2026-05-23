"use client";

import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import { CATEGORY_COLORS } from "./canvas-constants";
import type { CanvasTaskNodeData } from "./workflow-graph-conversions";
import { getVisualSpec } from "./task-type-visual-registry";
import { NodeShell, NodeContent, NodeHandles, NodeActions, ExecutionBadge } from "./node-shell";
import { useWorkflowGraphMode } from "./WorkflowGraphModeContext";

const NESTED_TASK_KINDS = new Set(["fork", "for_each", "try_catch"]);

/**
 * Unified workflow node component for the React Flow canvas.
 *
 * Composes single-responsibility sub-components and adapts rendering
 * based on the current graph mode (design / overview / execution):
 * - `NodeShell` — visual shape boundary (CSS or SVG based on visual class)
 * - `NodeContent` — task name + kind badge
 * - `NodeHandles` — connection ports driven by the visual registry
 * - `NodeActions` — design-mode only interaction affordances
 * - `ExecutionBadge` — execution-mode only status badge
 */
export const WorkflowNode = memo(function WorkflowNode({
  id,
  data,
  selected,
}: NodeProps & { data: CanvasTaskNodeData }) {
  const mode = useWorkflowGraphMode();
  const visualSpec = getVisualSpec(data.isSentinel ? id : data.kindString);
  const categoryColor = CATEGORY_COLORS[data.category];
  const errorCount = data.errorCount ?? 0;
  const isNested = NESTED_TASK_KINDS.has(data.kindString);
  const executionState = data.executionState;

  return (
    <div
      data-visual-class={data.visualClass}
      data-task-kind={data.kindString}
      data-execution-status={executionState?.status}
      aria-label={buildAriaLabel(data, errorCount, executionState?.status)}
    >
      <NodeShell
        visualClass={visualSpec.visualClass}
        width={visualSpec.defaultWidth}
        height={visualSpec.defaultHeight}
        categoryColor={categoryColor}
        selected={selected}
        errorCount={mode === "design" ? errorCount : 0}
        executionStatus={executionState?.status}
      >
        <NodeContent
          visualClass={visualSpec.visualClass}
          taskName={data.taskName}
          displayName={data.displayName}
          categoryColor={categoryColor}
          isNested={isNested}
        />
      </NodeShell>

      {/* Validation badge — design mode only */}
      {mode === "design" && errorCount > 0 && (
        <span
          className="absolute -right-1.5 -top-1.5 z-20 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--stgm-destructive,#ef4444)] px-1 text-[9px] font-bold leading-none text-white"
          title={`${errorCount} validation ${errorCount === 1 ? "error" : "errors"}`}
        >
          {errorCount}
        </span>
      )}

      {/* Execution badge — execution mode only */}
      {mode === "execution" && executionState && (
        <ExecutionBadge
          status={executionState.status}
          attemptNumber={executionState.attemptNumber}
          forkProgress={data.forkProgress ?? undefined}
        />
      )}

      <NodeHandles portPattern={visualSpec.portPattern} data={data} />

      {/* Design-mode actions — hidden in other modes */}
      {mode === "design" && !data.isSentinel && (
        <NodeActions nodeId={id} taskName={data.taskName} kindString={data.kindString} />
      )}
    </div>
  );
});

function buildAriaLabel(
  data: CanvasTaskNodeData,
  errorCount: number,
  executionStatus?: string,
): string {
  const base = `${data.displayName} node ${data.taskName}, ${data.ariaShapeLabel} shape`;
  const parts = [base];
  if (executionStatus && executionStatus !== "not_reached") {
    parts.push(executionStatus.replace(/_/g, " "));
  }
  if (errorCount > 0) {
    parts.push(`${errorCount} ${errorCount === 1 ? "error" : "errors"}`);
  }
  return parts.join(", ");
}
