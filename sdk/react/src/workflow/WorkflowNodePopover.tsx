"use client";

import { memo, useCallback, useEffect, useRef } from "react";
import { cn } from "@stigmer/theme";
import type { CanvasTaskNodeData } from "./workflow-graph-conversions";
import { kindToDisplayName, categorizeKind } from "./kind-metadata";
import { CATEGORY_COLORS } from "./canvas-constants";

/** Props for {@link WorkflowNodePopover}. */
export interface WorkflowNodePopoverProps {
  /** Node data from the clicked node. */
  readonly data: CanvasTaskNodeData;
  /** X position relative to the graph container. */
  readonly x: number;
  /** Y position relative to the graph container. */
  readonly y: number;
  /** Called to dismiss the popover. */
  readonly onClose: () => void;
  /**
   * Called when the user clicks "Open in editor".
   * Receives the task name so the host can switch to the editor tab.
   */
  readonly onOpenInEditor?: (taskName: string) => void;
}

/**
 * Lightweight popover shown when clicking a node in the overview graph.
 *
 * Displays the task name, kind, category, and a brief config summary.
 * Provides an "Open in editor" action link via callback prop.
 *
 * Positioned absolutely relative to the graph container at the click
 * coordinates, with viewport clamping to stay within bounds.
 */
export const WorkflowNodePopover = memo(function WorkflowNodePopover({
  data,
  x,
  y,
  onClose,
  onOpenInEditor,
}: WorkflowNodePopoverProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as HTMLElement)) {
        onClose();
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  const handleOpenInEditor = useCallback(() => {
    onOpenInEditor?.(data.taskName);
    onClose();
  }, [onOpenInEditor, data.taskName, onClose]);

  const displayName = kindToDisplayName(data.kindString);
  const category = categorizeKind(data.kindString);
  const categoryColor = CATEGORY_COLORS[category];
  const configSummary = extractConfigSummary(data);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={`${data.taskName} task details`}
      className={cn(
        "absolute z-50 w-64 overflow-visible rounded-lg border border-[var(--stgm-border,#d4d4d8)]",
        "bg-[var(--stgm-popover,#fff)] p-3 shadow-lg",
        "text-[var(--stgm-popover-foreground,#1a1a2e)]",
      )}
      style={{
        left: Math.min(x, (ref.current?.parentElement?.clientWidth ?? 800) - 272),
        top: y + 8,
        minWidth: "16rem",
      }}
    >
      <div className="mb-2 flex items-center gap-2">
        <span
          className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: categoryColor }}
          aria-hidden="true"
        />
        <span className="truncate text-sm font-medium">{data.taskName}</span>
      </div>

      <div className="mb-2 flex items-center gap-2 text-xs text-[var(--stgm-muted-foreground,#737373)]">
        <span className="rounded bg-[var(--stgm-muted,#f5f5f5)] px-1.5 py-0.5 font-medium">
          {displayName}
        </span>
        <span className="capitalize">{category.replace(/_/g, " ")}</span>
      </div>

      {configSummary && (
        <p className="mb-2 truncate text-xs text-[var(--stgm-muted-foreground,#737373)]">
          {configSummary}
        </p>
      )}

      {onOpenInEditor && (
        <button
          type="button"
          onClick={handleOpenInEditor}
          className={cn(
            "mt-1 block w-full whitespace-nowrap rounded-md px-2.5 py-1.5 text-center text-xs font-medium",
            "bg-[var(--stgm-primary,#6366f1)] text-[var(--stgm-primary-foreground,#fff)]",
            "hover:bg-[var(--stgm-primary-hover,#4f46e5)]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--stgm-ring,#6366f1)]",
            "transition-colors",
          )}
        >
          Open in editor
        </button>
      )}
    </div>
  );
});

function extractConfigSummary(data: CanvasTaskNodeData): string | null {
  const config = data.config as Record<string, unknown> | undefined;
  if (!config) return null;

  switch (data.kindString) {
    case "agent_call": {
      const agent = config.agent as string | undefined;
      return agent ? `Agent: ${agent}` : null;
    }
    case "call_http":
    case "http_call": {
      const method = (config.method as string) ?? "GET";
      const url = config.url as string | undefined;
      return url ? `${method.toUpperCase()} ${url}` : null;
    }
    case "call_llm":
    case "llm_call": {
      const model = config.model as string | undefined;
      return model ? `Model: ${model}` : null;
    }
    case "switch_case": {
      const cases = config.cases as unknown[];
      return cases ? `${cases.length} case${cases.length === 1 ? "" : "s"}` : null;
    }
    case "fork": {
      const branches = config.branches as unknown[];
      return branches ? `${branches.length} branch${branches.length === 1 ? "" : "es"}` : null;
    }
    case "wait": {
      const dur = config.duration as Record<string, unknown> | undefined;
      const secs = dur?.seconds as number | undefined;
      return secs ? `Wait ${secs}s` : null;
    }
    case "run_workflow": {
      const wfRef = config.workflow_ref as string | undefined;
      return wfRef ? `Workflow: ${wfRef}` : null;
    }
    default:
      return null;
  }
}
