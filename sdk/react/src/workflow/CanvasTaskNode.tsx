"use client";

import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import { cn } from "@stigmer/theme";
import { CATEGORY_COLORS } from "./canvas-constants";
import type { CanvasTaskNodeData } from "./workflow-graph-conversions";

const NESTED_TASK_KINDS = new Set(["fork", "for_each", "try_catch"]);

/**
 * Custom React Flow node rendering a single workflow task.
 *
 * Displays the task's kind via category-colored left border,
 * task name, kind badge, and appropriate connection handles.
 * Sentinel nodes (__start__, __end__) render as compact pills.
 *
 * Multi-port output handles are rendered for `switch_case` (per case)
 * and `human_input` (per outcome) task kinds.
 *
 * @since T15 (Visual Canvas Editor)
 */
export const CanvasTaskNode = memo(function CanvasTaskNode({
  data,
  selected,
}: NodeProps & { data: CanvasTaskNodeData }) {
  if (data.isSentinel) {
    return <SentinelNode data={data} selected={selected} />;
  }

  const borderColor = CATEGORY_COLORS[data.category];
  const isNested = NESTED_TASK_KINDS.has(data.kindString);
  const errorCount = data.errorCount ?? 0;

  const multiOutputHandles = getMultiOutputHandles(data);
  const hasMultipleOutputs = multiOutputHandles.length > 0;

  return (
    <div
      className={cn(
        "stgm relative flex min-w-[200px] items-center gap-2 rounded-md border border-[var(--stgm-border-prominent,#d4d4d8)] bg-[var(--stgm-card,var(--stgm-background,#fff))] px-3 py-2 shadow-sm transition-shadow",
        selected && "ring-2 ring-[var(--stgm-ring,#3b82f6)]",
        errorCount > 0 && "!border-[var(--stgm-destructive,#ef4444)]",
      )}
      style={{ borderLeftWidth: 4, borderLeftColor: borderColor }}
      aria-label={`Task: ${data.taskName}, type: ${formatKindLabel(data.kindString)}${errorCount > 0 ? `, ${errorCount} ${errorCount === 1 ? "error" : "errors"}` : ""}`}
    >
      {errorCount > 0 && (
        <span
          className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--stgm-destructive,#ef4444)] px-1 text-[9px] font-bold leading-none text-white"
          title={`${errorCount} validation ${errorCount === 1 ? "error" : "errors"}`}
        >
          {errorCount}
        </span>
      )}
      <Handle
        type="target"
        position={Position.Top}
        className="!h-2 !w-2 !rounded-full !border-[var(--stgm-border-prominent,#d4d4d8)] !bg-[var(--stgm-card,var(--stgm-background,#fff))]"
      />

      <div className="flex flex-1 flex-col gap-0.5 overflow-hidden">
        <span className="truncate text-sm font-medium text-[var(--stgm-foreground,#1a1a2e)]">
          {data.taskName}
        </span>
        <div className="flex items-center gap-1.5">
          <span
            className="inline-block rounded px-1 py-px text-[10px] font-medium leading-tight"
            style={{
              color: borderColor,
              backgroundColor: `color-mix(in srgb, ${borderColor} 12%, transparent)`,
            }}
          >
            {formatKindLabel(data.kindString)}
          </span>
          {isNested && (
            <span className="text-[10px] text-[var(--stgm-muted-foreground,#737373)]">
              (nested)
            </span>
          )}
        </div>
      </div>

      {hasMultipleOutputs ? (
        <>
          {multiOutputHandles.map((handle, idx) => {
            const leftPct = ((idx + 1) / (multiOutputHandles.length + 1)) * 100;
            return (
              <div key={handle.id}>
                <Handle
                  type="source"
                  position={Position.Bottom}
                  id={handle.id}
                  className="!h-2 !w-2 !rounded-full !border-[var(--stgm-border-prominent,#d4d4d8)] !bg-[var(--stgm-card,var(--stgm-background,#fff))]"
                  style={{ left: `${leftPct}%` }}
                />
                <span
                  className="pointer-events-none absolute text-[8px] font-medium leading-none text-[var(--stgm-muted-foreground,#737373)]"
                  style={{
                    left: `${leftPct}%`,
                    bottom: -14,
                    transform: "translateX(-50%)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {handle.label}
                </span>
              </div>
            );
          })}
        </>
      ) : (
        <Handle
          type="source"
          position={Position.Bottom}
          className="!h-2 !w-2 !rounded-full !border-[var(--stgm-border-prominent,#d4d4d8)] !bg-[var(--stgm-card,var(--stgm-background,#fff))]"
        />
      )}
    </div>
  );
});

// ---------------------------------------------------------------------------
// SentinelNode
// ---------------------------------------------------------------------------

function SentinelNode({
  data,
  selected,
}: {
  data: CanvasTaskNodeData;
  selected?: boolean;
}) {
  const isStart = data.category === "start";

  return (
    <div
      className={cn(
        "stgm flex items-center justify-center rounded-full border-2 px-4 py-1.5",
        "bg-[var(--stgm-muted,#f5f5f5)] text-xs font-medium text-[var(--stgm-foreground,#1a1a2e)]",
        selected && "ring-2 ring-[var(--stgm-ring,#3b82f6)]",
      )}
      style={{ borderColor: CATEGORY_COLORS[data.category] }}
    >
      {isStart ? (
        <Handle
          type="source"
          position={Position.Bottom}
          className="!h-2 !w-2 !rounded-full !border-[var(--stgm-border-prominent,#d4d4d8)] !bg-[var(--stgm-muted,#f5f5f5)]"
        />
      ) : (
        <Handle
          type="target"
          position={Position.Top}
          className="!h-2 !w-2 !rounded-full !border-[var(--stgm-border-prominent,#d4d4d8)] !bg-[var(--stgm-muted,#f5f5f5)]"
        />
      )}
      {data.taskName}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Multi-output handle helpers
// ---------------------------------------------------------------------------

interface OutputHandle {
  id: string;
  label: string;
}

/**
 * Extracts multi-output handles for task kinds that support branching:
 * - `switch_case`: one handle per case entry
 * - `human_input`: one handle per outcome entry
 *
 * Returns empty array for all other task kinds (single default output).
 */
function getMultiOutputHandles(data: CanvasTaskNodeData): OutputHandle[] {
  const config = data.config as Record<string, unknown> | undefined;
  if (!config) return [];

  if (data.kindString === "switch_case") {
    const cases = config.cases;
    if (!Array.isArray(cases)) return [];
    return cases
      .filter((c): c is Record<string, unknown> => c != null && typeof c === "object" && typeof c.name === "string")
      .map((c) => ({
        id: `case_${c.name as string}`,
        label: c.name as string,
      }));
  }

  if (data.kindString === "human_input") {
    const outcomes = config.outcomes;
    if (!Array.isArray(outcomes)) return [];
    return outcomes
      .filter((o): o is Record<string, unknown> => o != null && typeof o === "object" && typeof o.name === "string")
      .map((o) => ({
        id: `outcome_${o.name as string}`,
        label: o.name as string,
      }));
  }

  return [];
}

function formatKindLabel(kind: string): string {
  return kind.replace(/_/g, " ");
}
