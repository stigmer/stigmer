"use client";

import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import { CATEGORY_COLORS } from "./canvas-constants.js";
import type { CanvasTaskNodeData } from "./workflow-graph-conversions.js";
import { getVisualSpec } from "./task-type-visual-registry.js";
import { NodeShell, NodeContent, NodeHandles, NodeActions, ExecutionBadge, BranchBadge, DiffBadge } from "./node-shell/index.js";
import { useWorkflowGraphMode } from "./WorkflowGraphModeContext.js";

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
  const diffState = data.diffState;

  return (
    <div
      data-visual-class={data.visualClass}
      data-task-kind={data.kindString}
      data-execution-status={executionState?.status}
      data-diff-status={diffState?.status}
      aria-label={buildAriaLabel(data, errorCount, executionState?.status)}
      role="button"
      className="stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-[var(--stgm-ring,#3b82f6)] stg:focus-visible:ring-offset-1 stg:rounded-sm"
    >
      <NodeShell
        visualClass={visualSpec.visualClass}
        width={visualSpec.defaultWidth}
        height={visualSpec.defaultHeight}
        captionHeight={visualSpec.captionHeight}
        categoryColor={categoryColor}
        selected={selected}
        errorCount={mode === "design" ? errorCount : 0}
        executionStatus={executionState?.status}
        diffStatus={mode === "diff" ? diffState?.status : undefined}
      >
        <NodeContent
          visualClass={visualSpec.visualClass}
          taskName={data.taskName}
          displayName={data.displayName}
          categoryColor={categoryColor}
          captionHeight={visualSpec.captionHeight}
          isNested={isNested}
        />
      </NodeShell>

      {/* Validation badge — design mode only */}
      {mode === "design" && errorCount > 0 && (
        <span
          className="stg:absolute stg:-right-1.5 stg:-top-1.5 stg:z-20 stg:flex stg:h-4 stg:min-w-4 stg:items-center stg:justify-center stg:rounded-full stg:bg-[var(--stgm-destructive,#ef4444)] stg:px-1 stg:text-[9px] stg:font-bold stg:leading-none stg:text-[var(--stgm-destructive-foreground,#fff)]"
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
          approvalToolName={data.approvalToolName}
          agentActivity={data.agentActivity ?? undefined}
        />
      )}

      {/* Diff badge — diff mode only */}
      {mode === "diff" && diffState && (
        <DiffBadge
          status={diffState.status}
          changedFieldCount={diffState.changedFields?.length}
        />
      )}

      <NodeHandles portPattern={visualSpec.portPattern} data={data} />

      {/* Branch badge — design mode only, for container/branch nodes */}
      {mode === "design" && isNested && (
        <BranchBadge kindString={data.kindString} config={data.config} />
      )}

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

  const config = data.config as Record<string, unknown>;
  if (data.kindString === "switch_case" && Array.isArray(config.cases)) {
    const caseNames = (config.cases as Array<Record<string, unknown>>)
      .filter((c) => c && typeof c.name === "string")
      .map((c) => c.name as string);
    if (caseNames.length > 0) {
      parts.push(`${caseNames.length} branches: ${caseNames.join(", ")}`);
    }
  } else if (data.kindString === "fork" && Array.isArray(config.branches)) {
    const branchNames = (config.branches as Array<Record<string, unknown>>)
      .filter((b) => b && typeof b.name === "string")
      .map((b) => b.name as string);
    if (branchNames.length > 0) {
      const joinPolicy = config.compete === true ? "race mode" : "wait for all";
      parts.push(`${branchNames.length} branches: ${branchNames.join(", ")}. Join policy: ${joinPolicy}`);
    }
  } else if (data.kindString === "try_catch" && config.catch && typeof config.catch === "object") {
    const catchAs = (config.catch as Record<string, unknown>).as as string | undefined;
    parts.push(`catch handler: ${catchAs || "error"}`);
  } else if (data.kindString === "for_each") {
    const par = (config.max_parallelism as number) || 0;
    parts.push(par > 0 ? `concurrency: ${par}` : "sequential");
  }

  if (executionStatus && executionStatus !== "not_reached") {
    parts.push(executionStatus.replace(/_/g, " "));
  }
  if (errorCount > 0) {
    parts.push(`${errorCount} ${errorCount === 1 ? "error" : "errors"}`);
  }
  return parts.join(", ");
}
