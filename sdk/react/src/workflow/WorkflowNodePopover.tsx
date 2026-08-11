"use client";

import { memo, useCallback, useEffect, useRef } from "react";
import { cn } from "@stigmer/theme";
import type { CanvasTaskNodeData } from "./workflow-graph-conversions.js";
import { kindToDisplayName, categorizeKind } from "./kind-metadata.js";
import { CATEGORY_COLORS } from "./canvas-constants.js";

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
        "stg:absolute stg:z-50 stg:w-64 stg:overflow-visible stg:rounded-lg stg:border stg:border-[var(--stgm-border,#d4d4d8)]",
        "stg:bg-[var(--stgm-popover,#fff)] stg:p-3 stg:shadow-lg",
        "stg:text-[var(--stgm-popover-foreground,#1a1a2e)]",
      )}
      style={{
        left: Math.min(x, (ref.current?.parentElement?.clientWidth ?? 800) - 272),
        top: y + 8,
        minWidth: "16rem",
      }}
    >
      <div className="stg:mb-2 stg:flex stg:items-center stg:gap-2">
        <span
          className="stg:inline-block stg:h-2.5 stg:w-2.5 stg:shrink-0 stg:rounded-full"
          style={{ backgroundColor: categoryColor }}
          aria-hidden="true"
        />
        <span className="stg:truncate stg:text-sm stg:font-medium">{data.taskName}</span>
      </div>

      <div className="stg:mb-2 stg:flex stg:items-center stg:gap-2 stg:text-xs stg:text-[var(--stgm-muted-foreground,#737373)]">
        <span className="stg:rounded stg:bg-[var(--stgm-muted,#f5f5f5)] stg:px-1.5 stg:py-0.5 stg:font-medium">
          {displayName}
        </span>
        <span className="stg:capitalize">{category.replace(/_/g, " ")}</span>
      </div>

      {configSummary && (
        <p className="stg:mb-2 stg:truncate stg:text-xs stg:text-[var(--stgm-muted-foreground,#737373)]">
          {configSummary}
        </p>
      )}

      {onOpenInEditor && (
        <button
          type="button"
          onClick={handleOpenInEditor}
          className={cn(
            "stg:mt-1 stg:block stg:w-full stg:whitespace-nowrap stg:rounded-md stg:px-2.5 stg:py-1.5 stg:text-center stg:text-xs stg:font-medium",
            "stg:bg-[var(--stgm-primary,#6366f1)] stg:text-[var(--stgm-primary-foreground,#fff)]",
            "stg:hover:bg-[var(--stgm-primary-hover,#4f46e5)]",
            "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-[var(--stgm-ring,#6366f1)]",
            "stg:transition-colors",
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
