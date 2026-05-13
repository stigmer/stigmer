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
 * Displays the task's kind icon via category-colored left border,
 * task name, kind badge, and appropriate connection handles.
 * Sentinel nodes (__start__, __end__) render as compact pills.
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
  const switchCases = data.kindString === "switch_case" ? getSwitchCases(data) : [];
  const hasMulitpleOutputs = switchCases.length > 0;

  return (
    <div
      className={cn(
        "stgm relative flex min-w-[200px] items-center gap-2 rounded-md border bg-[var(--stgm-background,#fff)] px-3 py-2 shadow-sm transition-shadow",
        selected && "ring-2 ring-[var(--stgm-ring,#3b82f6)]",
      )}
      style={{ borderLeftWidth: 4, borderLeftColor: borderColor }}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!h-2 !w-2 !rounded-full !border-[var(--stgm-border,#d4d4d8)] !bg-[var(--stgm-background,#fff)]"
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

      {hasMulitpleOutputs ? (
        switchCases.map((caseName, idx) => (
          <Handle
            key={`case_${idx}`}
            type="source"
            position={Position.Bottom}
            id={`case_${idx}`}
            className="!h-2 !w-2 !rounded-full !border-[var(--stgm-border,#d4d4d8)] !bg-[var(--stgm-background,#fff)]"
            style={{
              left: `${((idx + 1) / (switchCases.length + 1)) * 100}%`,
            }}
          />
        ))
      ) : (
        <Handle
          type="source"
          position={Position.Bottom}
          className="!h-2 !w-2 !rounded-full !border-[var(--stgm-border,#d4d4d8)] !bg-[var(--stgm-background,#fff)]"
        />
      )}
    </div>
  );
});

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
        "stgm flex items-center justify-center rounded-full border px-4 py-1.5",
        "bg-[var(--stgm-muted,#f5f5f5)] text-xs font-medium text-[var(--stgm-muted-foreground,#737373)]",
        selected && "ring-2 ring-[var(--stgm-ring,#3b82f6)]",
      )}
      style={{ borderColor: CATEGORY_COLORS[data.category] }}
    >
      {isStart ? (
        <Handle
          type="source"
          position={Position.Bottom}
          className="!h-2 !w-2 !rounded-full !border-[var(--stgm-border,#d4d4d8)] !bg-[var(--stgm-muted,#f5f5f5)]"
        />
      ) : (
        <Handle
          type="target"
          position={Position.Top}
          className="!h-2 !w-2 !rounded-full !border-[var(--stgm-border,#d4d4d8)] !bg-[var(--stgm-muted,#f5f5f5)]"
        />
      )}
      {data.taskName}
    </div>
  );
}

function getSwitchCases(data: CanvasTaskNodeData): string[] {
  const cases = (data.config as Record<string, unknown>)?.cases;
  if (!Array.isArray(cases)) return [];
  return cases
    .filter((c): c is Record<string, unknown> => c != null && typeof c === "object")
    .map((c) => (typeof c.name === "string" ? c.name : ""));
}

function formatKindLabel(kind: string): string {
  return kind.replace(/_/g, " ");
}
