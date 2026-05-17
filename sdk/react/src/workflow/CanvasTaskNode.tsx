"use client";

import { forwardRef, memo, useCallback, useContext, useRef, useState } from "react";
import { Handle, Position, NodeToolbar } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import { cn } from "@stigmer/theme";
import { CATEGORY_COLORS } from "./canvas-constants";
import type { CanvasTaskNodeData } from "./workflow-graph-conversions";
import { CanvasActionsContext } from "./CanvasActionsContext";
import { TaskPickerPopover } from "./TaskPickerPopover";
import { TrashIcon, DuplicateIcon, PlusIcon } from "./canvas-icons";

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
  id,
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

  const actions = useContext(CanvasActionsContext);

  const handleDelete = useCallback(() => {
    actions?.deleteNode(id);
  }, [actions, id]);

  const handleDuplicate = useCallback(() => {
    actions?.duplicateNode(id);
  }, [actions, id]);

  const [pickerOpen, setPickerOpen] = useState(false);
  const hoverAddRef = useRef<HTMLButtonElement>(null);
  const toolbarAddRef = useRef<HTMLButtonElement>(null);
  const pickerAnchorRef = useRef<HTMLButtonElement | null>(null);

  const openPickerFrom = useCallback(
    (ref: React.RefObject<HTMLButtonElement | null>) => {
      pickerAnchorRef.current = ref.current;
      setPickerOpen(true);
    },
    [],
  );

  const handleHoverAddClick = useCallback(() => {
    openPickerFrom(hoverAddRef);
  }, [openPickerFrom]);

  const handleToolbarAddClick = useCallback(() => {
    openPickerFrom(toolbarAddRef);
  }, [openPickerFrom]);

  const handlePickerOpenChange = useCallback((nextOpen: boolean) => {
    setPickerOpen(nextOpen);
  }, []);

  const handleKindSelected = useCallback(
    (kindString: string) => {
      actions?.addSuccessorTask(id, kindString);
    },
    [actions, id],
  );

  return (
    <div
      className={cn(
        "stgm group relative flex min-w-[200px] items-center gap-2 rounded-md border border-[var(--stgm-border-prominent,#d4d4d8)] bg-[var(--stgm-card,var(--stgm-background,#fff))] px-3 py-2 shadow-sm transition-shadow",
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

      {/* Selection toolbar — auto-shown by React Flow when selected */}
      <NodeToolbar position={Position.Top} offset={8} align="center">
        <div
          className="stgm flex items-center gap-0.5 rounded-md border border-[var(--stgm-border,#e5e5e5)] bg-[var(--stgm-popover,var(--stgm-background,#fff))] p-0.5 shadow-md"
          role="toolbar"
          aria-label="Task actions"
          aria-orientation="horizontal"
        >
          <ToolbarButton
            icon={<DuplicateIcon />}
            label={`Duplicate task ${data.taskName}`}
            title="Duplicate"
            onClick={handleDuplicate}
          />
          <ToolbarButton
            ref={toolbarAddRef}
            icon={<PlusIcon />}
            label={`Add task after ${data.taskName}`}
            title="Add task after"
            onClick={handleToolbarAddClick}
          />
          <div className="mx-0.5 h-4 w-px bg-[var(--stgm-border,#e5e5e5)]" aria-hidden="true" />
          <ToolbarButton
            icon={<TrashIcon />}
            label={`Delete task ${data.taskName}`}
            title="Delete"
            onClick={handleDelete}
            destructive
          />
        </div>
      </NodeToolbar>

      {/* Delete button — revealed on hover via CSS group */}
      <button
        type="button"
        onClick={handleDelete}
        className={cn(
          "absolute -right-2 -top-2 z-10 flex h-5 w-5 items-center justify-center rounded-full border border-[var(--stgm-border-prominent,#d4d4d8)] bg-[var(--stgm-card,var(--stgm-background,#fff))] text-[var(--stgm-muted-foreground,#737373)] shadow-sm transition-all",
          "hover:border-[var(--stgm-destructive,#ef4444)] hover:bg-[var(--stgm-destructive,#ef4444)] hover:text-[var(--stgm-primary-foreground,#fff)]",
          "scale-75 opacity-0 group-hover:scale-100 group-hover:opacity-100",
        )}
        aria-label={`Delete task ${data.taskName}`}
        title="Delete task"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
          <path d="M2 3h6M3.5 3V2.5a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 .5.5V3M4 4.5v2.5M6 4.5v2.5M3 3l.5 5h3l.5-5" />
        </svg>
      </button>

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

      {/* Add successor button — revealed on hover via CSS group */}
      <button
        ref={hoverAddRef}
        type="button"
        onClick={handleHoverAddClick}
        className={cn(
          "absolute -bottom-3 left-1/2 z-10 flex h-5 w-5 -translate-x-1/2 items-center justify-center rounded-full border border-[var(--stgm-border-prominent,#d4d4d8)] bg-[var(--stgm-card,var(--stgm-background,#fff))] text-[var(--stgm-muted-foreground,#737373)] shadow-sm transition-all",
          "hover:border-[var(--stgm-primary,#6366f1)] hover:bg-[var(--stgm-primary,#6366f1)] hover:text-[var(--stgm-primary-foreground,#fff)]",
          "scale-75 opacity-0 group-hover:scale-100 group-hover:opacity-100",
        )}
        aria-label={`Add task after ${data.taskName}`}
        title="Add task"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
          <path d="M5 2v6M2 5h6" />
        </svg>
      </button>

      <TaskPickerPopover
        open={pickerOpen}
        onOpenChange={handlePickerOpenChange}
        onSelectKind={handleKindSelected}
        anchorRef={pickerAnchorRef as React.RefObject<HTMLElement | null>}
        side="bottom"
      />
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
// ToolbarButton
// ---------------------------------------------------------------------------

const TOOLBAR_BTN_CLASS = cn(
  "flex h-7 w-7 items-center justify-center rounded text-[var(--stgm-popover-foreground,var(--stgm-foreground,#1a1a2e))] outline-none transition-colors",
  "hover:bg-[var(--stgm-accent,#e5e5e5)] focus-visible:ring-1 focus-visible:ring-[var(--stgm-ring,#3b82f6)]",
);

const TOOLBAR_BTN_DESTRUCTIVE_CLASS = cn(
  "flex h-7 w-7 items-center justify-center rounded text-[var(--stgm-popover-foreground,var(--stgm-foreground,#1a1a2e))] outline-none transition-colors",
  "hover:bg-[var(--stgm-destructive,#ef4444)]/10 hover:text-[var(--stgm-destructive,#ef4444)] focus-visible:ring-1 focus-visible:ring-[var(--stgm-ring,#3b82f6)]",
);

interface ToolbarButtonProps {
  icon: React.ReactNode;
  label: string;
  title: string;
  onClick: () => void;
  destructive?: boolean;
}

const ToolbarButton = forwardRef<HTMLButtonElement, ToolbarButtonProps>(
  function ToolbarButton({ icon, label, title, onClick, destructive }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        onClick={onClick}
        className={destructive ? TOOLBAR_BTN_DESTRUCTIVE_CLASS : TOOLBAR_BTN_CLASS}
        aria-label={label}
        title={title}
      >
        {icon}
      </button>
    );
  },
);

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
