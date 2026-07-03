"use client";

import { memo } from "react";
import { cn } from "@stigmer/theme";
import type { VisualClass } from "../task-type-visual-registry.js";
import type { NodeExecutionStatus } from "../workflow-graph-conversions.js";
import type { NodeDiffStatus } from "../diff/types.js";
import { getShapePath, SVG_SHAPE_CLASSES } from "./shape-paths.js";

export interface NodeShellProps {
  visualClass: VisualClass;
  width: number;
  height: number;
  /** Height reserved for the caption below the shape (0 for internal text shapes). */
  captionHeight?: number;
  categoryColor: string;
  selected?: boolean;
  errorCount?: number;
  executionStatus?: NodeExecutionStatus;
  diffStatus?: NodeDiffStatus;
  children: React.ReactNode;
}

/**
 * Visual boundary renderer for workflow nodes.
 *
 * Dispatches between two rendering strategies:
 * - Rectangular shapes (task-card, subworkflow-card, container, terminal-pill):
 *   Standard div with CSS borders, border-radius, and background.
 * - Non-rectangular shapes (decision-diamond, gate-octagon, event-circle, parallel-bar):
 *   SVG path background with HTML content overlay.
 *
 * The outer container is always a rectangular div for React Flow
 * hit-testing compatibility.
 */
export const NodeShell = memo(function NodeShell({
  visualClass,
  width,
  height,
  captionHeight = 0,
  categoryColor,
  selected,
  errorCount = 0,
  executionStatus,
  diffStatus,
  children,
}: NodeShellProps) {
  if (SVG_SHAPE_CLASSES.has(visualClass)) {
    return (
      <SvgShell
        visualClass={visualClass}
        width={width}
        height={height}
        captionHeight={captionHeight}
        categoryColor={categoryColor}
        selected={selected}
        errorCount={errorCount}
        executionStatus={executionStatus}
        diffStatus={diffStatus}
      >
        {children}
      </SvgShell>
    );
  }

  return (
    <CssShell
      visualClass={visualClass}
      categoryColor={categoryColor}
      selected={selected}
      errorCount={errorCount}
      executionStatus={executionStatus}
      diffStatus={diffStatus}
    >
      {children}
    </CssShell>
  );
});

// ---------------------------------------------------------------------------
// CssShell — for rectangular visual classes
// ---------------------------------------------------------------------------

function CssShell({
  visualClass,
  categoryColor,
  selected,
  errorCount = 0,
  executionStatus,
  diffStatus,
  children,
}: Omit<NodeShellProps, "width" | "height">) {
  const shellClass = CSS_VARIANTS[visualClass] ?? CSS_VARIANTS["task-card"];

  return (
    <div
      className={cn(
        "stgm group relative flex items-center transition-shadow",
        shellClass,
        selected && "ring-2 ring-[var(--stgm-ring,#3b82f6)]",
        diffStatus && DIFF_STATUS_CSS[diffStatus],
        !diffStatus && errorCount > 0 && "!border-[var(--stgm-destructive,#ef4444)]",
        !diffStatus && executionStatus && EXECUTION_STATUS_CSS[executionStatus],
      )}
      style={
        visualClass === "task-card" || visualClass === "subworkflow-card"
          ? { borderLeftWidth: 4, borderLeftColor: categoryColor }
          : undefined
      }
      data-execution-status={executionStatus}
      data-diff-status={diffStatus}
    >
      {children}
    </div>
  );
}

const CSS_VARIANTS: Partial<Record<VisualClass, string>> = {
  "task-card": cn(
    "min-w-[200px] gap-2 rounded-md border border-[var(--stgm-border-prominent,#d4d4d8)]",
    "bg-[var(--stgm-card,var(--stgm-background,#fff))] px-3 py-2 shadow-sm",
  ),
  "subworkflow-card": cn(
    "min-w-[200px] gap-2 rounded-md border-2 border-[var(--stgm-border-prominent,#d4d4d8)]",
    "bg-[var(--stgm-card,var(--stgm-background,#fff))] px-3 py-2 shadow-sm",
  ),
  "container": cn(
    "min-w-[240px] gap-2 rounded-lg border-2 border-dashed border-[var(--stgm-border-prominent,#d4d4d8)]",
    "bg-[var(--stgm-card,var(--stgm-background,#fff))] px-3 py-2.5 shadow-sm",
  ),
  "terminal-pill": cn(
    "items-center justify-center rounded-full border-2 px-4 py-1.5",
    "bg-[var(--stgm-muted,#f5f5f5)]",
  ),
};

// ---------------------------------------------------------------------------
// SvgShell — for non-rectangular visual classes
// ---------------------------------------------------------------------------

function SvgShell({
  visualClass,
  width,
  height,
  captionHeight = 0,
  categoryColor,
  selected,
  errorCount = 0,
  executionStatus,
  diffStatus,
  children,
}: NodeShellProps) {
  const shapeHeight = height;
  const totalHeight = height + captionHeight;
  const pathD = getShapePath(visualClass, width, shapeHeight);

  const strokeColor = diffStatus
    ? svgStrokeForDiffStatus(diffStatus, categoryColor)
    : executionStatus
      ? svgStrokeForStatus(executionStatus, categoryColor)
      : errorCount > 0
        ? "var(--stgm-destructive, #ef4444)"
        : categoryColor;

  return (
    <div
      className={cn(
        "stgm group relative flex flex-col items-center transition-shadow",
        selected && "ring-2 ring-[var(--stgm-ring,#3b82f6)]",
        visualClass === "decision-diamond" && "rounded-sm",
        visualClass === "event-circle" && "rounded-full",
        visualClass === "gate-octagon" && "rounded",
        diffStatus && DIFF_STATUS_CSS[diffStatus],
        !diffStatus && executionStatus && EXECUTION_STATUS_CSS[executionStatus],
      )}
      style={{ width, height: totalHeight }}
      data-execution-status={executionStatus}
      data-diff-status={diffStatus}
    >
      {/* Shape area */}
      <div className="relative flex items-center justify-center" style={{ width, height: shapeHeight }}>
        <svg
          className="pointer-events-none absolute inset-0"
          width={width}
          height={shapeHeight}
          viewBox={`0 0 ${width} ${shapeHeight}`}
          aria-hidden="true"
        >
          <path
            d={pathD ?? ""}
            fill="var(--stgm-card, var(--stgm-background, #fff))"
            stroke={strokeColor}
            strokeWidth="2"
            strokeDasharray={diffStatus === "removed" ? "6 4" : undefined}
          />
        </svg>
        <div className="relative z-10 flex items-center justify-center overflow-hidden">
          {children}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Execution status styling (T04)
// ---------------------------------------------------------------------------

/**
 * CSS class overrides per execution status. Applied to both CssShell and
 * SvgShell outer containers. Uses opacity and border-color tokens.
 * Never uses color alone — badges provide text/icon differentiation.
 */
const EXECUTION_STATUS_CSS: Record<NodeExecutionStatus, string> = {
  not_reached: "opacity-40",
  pending: "",
  running: "stgm-exec-running border-[var(--stgm-primary,#6366f1)]",
  completed: "border-[var(--stgm-success,#22c55e)]",
  failed: "!border-[var(--stgm-destructive,#ef4444)]",
  skipped: "opacity-50",
  retrying: "",
  waiting_approval: "border-[var(--stgm-warning,#f59e0b)]",
};

function svgStrokeForStatus(status: NodeExecutionStatus, fallback: string): string {
  switch (status) {
    case "running":
      return "var(--stgm-primary, #6366f1)";
    case "completed":
      return "var(--stgm-success, #22c55e)";
    case "failed":
      return "var(--stgm-destructive, #ef4444)";
    case "waiting_approval":
      return "var(--stgm-warning, #f59e0b)";
    default:
      return fallback;
  }
}

// ---------------------------------------------------------------------------
// Diff status styling (T14)
// ---------------------------------------------------------------------------

/**
 * CSS class overrides per diff status. Priority over execution and error
 * styling — diffStatus > executionStatus > errorCount > categoryColor.
 */
const DIFF_STATUS_CSS: Record<NodeDiffStatus, string> = {
  added: "border-[var(--stgm-success,#22c55e)] bg-[var(--stgm-success,#22c55e)]/5",
  removed: "opacity-50 border-dashed border-[var(--stgm-destructive,#ef4444)]",
  modified: "border-[var(--stgm-warning,#f59e0b)]",
  unchanged: "",
};

function svgStrokeForDiffStatus(status: NodeDiffStatus, fallback: string): string {
  switch (status) {
    case "added":
      return "var(--stgm-success, #22c55e)";
    case "removed":
      return "var(--stgm-destructive, #ef4444)";
    case "modified":
      return "var(--stgm-warning, #f59e0b)";
    default:
      return fallback;
  }
}
