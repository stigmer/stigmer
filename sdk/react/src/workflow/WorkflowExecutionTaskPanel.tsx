"use client";

import { memo } from "react";
import { cn } from "@stigmer/theme";
import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import type { DerivedTaskState } from "../internal/store/workflow-execution-event-store";

/** Props for {@link WorkflowExecutionTaskPanel}. */
export interface WorkflowExecutionTaskPanelProps {
  /** Derived task states from the event store. */
  readonly taskStates: ReadonlyMap<string, DerivedTaskState>;
  /** Total number of tasks declared in the workflow. */
  readonly totalTasks: number;
  /** Currently selected task name (for highlighting). */
  readonly selectedTaskName?: string | null;
  /** Callback when a task row is clicked. */
  readonly onSelectTask?: (taskName: string) => void;
  /** Additional CSS class names. */
  readonly className?: string;
}

const STATUS_CONFIG: Record<DerivedTaskState["status"], { icon: string; colorClass: string }> = {
  pending: { icon: "○", colorClass: "text-muted-foreground" },
  running: { icon: "●", colorClass: "text-foreground" },
  completed: { icon: "✓", colorClass: "text-success" },
  failed: { icon: "✕", colorClass: "text-destructive" },
  skipped: { icon: "⊘", colorClass: "text-muted-foreground" },
  retrying: { icon: "↻", colorClass: "text-muted-foreground" },
  waiting_approval: { icon: "◉", colorClass: "text-warning" },
};

const TASK_KIND_SHORT_LABEL: ReadonlyMap<WorkflowTaskKind, string> = new Map([
  [WorkflowTaskKind.agent_call, "agent"],
  [WorkflowTaskKind.llm_call, "llm"],
  [WorkflowTaskKind.http_call, "http"],
  [WorkflowTaskKind.grpc_call, "grpc"],
  [WorkflowTaskKind.transform, "transform"],
  [WorkflowTaskKind.human_input, "approval"],
  [WorkflowTaskKind.validate, "validate"],
  [WorkflowTaskKind.emit_event, "event"],
  [WorkflowTaskKind.notification, "notify"],
  [WorkflowTaskKind.eval, "eval"],
  [WorkflowTaskKind.switch_case, "switch"],
  [WorkflowTaskKind.for_each, "loop"],
  [WorkflowTaskKind.fork, "fork"],
  [WorkflowTaskKind.listen, "listen"],
  [WorkflowTaskKind.wait, "wait"],
]);

/**
 * Sidebar panel showing the status of each task in the workflow
 * execution. Tasks are ordered by their first appearance in the
 * event stream.
 *
 * Clicking a task row invokes `onSelectTask` which can be used
 * to scroll the timeline to events for that task.
 */
export const WorkflowExecutionTaskPanel = memo(function WorkflowExecutionTaskPanel({
  taskStates,
  totalTasks,
  selectedTaskName,
  onSelectTask,
  className,
}: WorkflowExecutionTaskPanelProps) {
  const tasks = Array.from(taskStates.values());

  const completedCount = tasks.filter(
    (t) => t.status === "completed" || t.status === "skipped",
  ).length;

  return (
    <div className={cn("flex flex-col", className)}>
      <div className="flex items-center justify-between px-3 py-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Tasks
        </h3>
        {totalTasks > 0 && (
          <span className="text-xs tabular-nums text-muted-foreground">
            {completedCount}/{totalTasks}
          </span>
        )}
      </div>

      {tasks.length === 0 ? (
        <p className="px-3 py-4 text-xs text-muted-foreground">No tasks started</p>
      ) : (
        <div className="flex flex-col">
          {tasks.map((task) => {
            const config = STATUS_CONFIG[task.status];
            const kindLabel = TASK_KIND_SHORT_LABEL.get(task.taskKind) ?? "";
            const isSelected = selectedTaskName === task.taskName;

            return (
              <button
                key={task.taskName}
                type="button"
                onClick={() => onSelectTask?.(task.taskName)}
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors",
                  "hover:bg-muted/50",
                  isSelected && "bg-muted",
                )}
              >
                <span className={cn("shrink-0 text-xs", config.colorClass)} aria-hidden="true">
                  {config.icon}
                </span>
                <span className="min-w-0 flex-1 truncate text-foreground">
                  {task.taskName}
                </span>
                {kindLabel && (
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {kindLabel}
                  </span>
                )}
                {task.durationMs > 0 && (
                  <span className="shrink-0 tabular-nums text-[10px] text-muted-foreground">
                    {formatDuration(task.durationMs)}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
});

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m`;
}
