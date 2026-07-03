"use client";

import { cn } from "@stigmer/theme";
import type { WorkflowGraphNode } from "../workflow-graph-model.js";
import { START_NODE_ID } from "../workflow-graph-model.js";

/** Props for {@link SentinelInspector}. */
export interface SentinelInspectorProps {
  readonly node: WorkflowGraphNode;
  readonly className?: string;
}

/**
 * Inspector for sentinel nodes (Start / End).
 *
 * Shows a brief description of the sentinel's role in the workflow.
 *
 * @since T10 (Inspector Panel Refactor) — extracted from WorkflowInspectorPanel
 */
export function SentinelInspector({ node, className }: SentinelInspectorProps) {
  const isStart = node.id === START_NODE_ID;

  return (
    <div className={cn("flex h-full flex-col gap-2 p-3", className)}>
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--stgm-muted-foreground,#737373)]">
        {isStart ? "Start" : "End"}
      </h3>
      <p className="text-xs text-[var(--stgm-muted-foreground,#737373)]">
        {isStart
          ? "Entry point of the workflow. The first task is connected automatically."
          : "Terminal point. Tasks routing here end the workflow execution."}
      </p>
    </div>
  );
}
