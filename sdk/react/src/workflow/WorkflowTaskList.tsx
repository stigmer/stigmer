"use client";

import { memo, useMemo } from "react";
import { cn } from "@stigmer/theme";
import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import type { WorkflowTask } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/spec_pb";
import { useTaskKindRegistryContext } from "./TaskKindRegistryContext.js";

/** Props for {@link WorkflowTaskList}. */
export interface WorkflowTaskListProps {
  /** Tasks from the workflow spec. */
  readonly tasks: readonly WorkflowTask[];
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

const TASK_KIND_LABELS: ReadonlyMap<WorkflowTaskKind, string> = new Map([
  [WorkflowTaskKind.set_vars, "Set Variables"],
  [WorkflowTaskKind.http_call, "HTTP Call"],
  [WorkflowTaskKind.grpc_call, "gRPC Call"],
  [WorkflowTaskKind.activity_call, "Activity Call"],
  [WorkflowTaskKind.switch_case, "Switch"],
  [WorkflowTaskKind.for_each, "For Each"],
  [WorkflowTaskKind.fork, "Fork"],
  [WorkflowTaskKind.try_catch, "Try/Catch"],
  [WorkflowTaskKind.listen, "Listen"],
  [WorkflowTaskKind.wait, "Wait"],
  [WorkflowTaskKind.raise_error, "Raise Error"],
  [WorkflowTaskKind.run_workflow, "Run Workflow"],
  [WorkflowTaskKind.agent_call, "Agent Call"],
  [WorkflowTaskKind.llm_call, "LLM Call"],
  [WorkflowTaskKind.transform, "Transform"],
  [WorkflowTaskKind.human_input, "Human Input"],
  [WorkflowTaskKind.validate, "Validate"],
  [WorkflowTaskKind.emit_event, "Emit Event"],
  [WorkflowTaskKind.notification, "Notification"],
  [WorkflowTaskKind.eval, "Evaluate (LLM Judge)"],
]);

/**
 * Compact list of tasks in a workflow specification.
 *
 * Renders each task as a row with a kind icon (from the TaskKindRegistry),
 * task name, kind label, and a sequential connector line indicating flow
 * order. When the registry is loading, kind icons are omitted gracefully.
 *
 * Zero Console dependencies — safe for platform builder embedding.
 * All visual properties flow through `--stgm-*` tokens.
 *
 * @example
 * ```tsx
 * <WorkflowTaskList tasks={workflow.spec?.tasks ?? []} />
 * ```
 */
export const WorkflowTaskList = memo(function WorkflowTaskList({
  tasks,
  className,
}: WorkflowTaskListProps) {
  const { descriptors } = useTaskKindRegistryContext();

  const kindIconMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of descriptors) {
      map.set(d.kind, d.icon);
    }
    return map;
  }, [descriptors]);

  if (tasks.length === 0) {
    return (
      <div className={cn("stg:py-8 stg:text-center stg:text-sm stg:text-muted-foreground", className)}>
        No tasks defined
      </div>
    );
  }

  return (
    <div className={cn("stg:flex stg:flex-col", className)}>
      {tasks.map((task, idx) => {
        const kindLabel = TASK_KIND_LABELS.get(task.kind) ?? formatKindName(task.kind);
        const iconName = kindIconMap.get(kindEnumToString(task.kind));
        const isLast = idx === tasks.length - 1;

        return (
          <div key={task.name} className="stg:flex stg:items-stretch stg:gap-3">
            {/* Vertical connector line */}
            <div className="stg:flex stg:w-5 stg:flex-col stg:items-center">
              <div
                className={cn(
                  "stg:flex stg:size-5 stg:shrink-0 stg:items-center stg:justify-center stg:rounded-full stg:border stg:border-border stg:bg-background stg:text-[10px] stg:font-medium stg:text-muted-foreground",
                )}
              >
                {idx + 1}
              </div>
              {!isLast && (
                <div className="stg:w-px stg:flex-1 stg:bg-border" />
              )}
            </div>

            {/* Task content */}
            <div className="stg:flex stg:min-w-0 stg:flex-1 stg:items-center stg:gap-2 stg:pb-3 stg:pt-0.5">
              {iconName && (
                <TaskKindIcon iconName={iconName} className="stg:size-4 stg:shrink-0 stg:text-muted-foreground" />
              )}
              <span className="stg:truncate stg:text-sm stg:font-medium stg:text-foreground">
                {task.name}
              </span>
              <span className="stg:shrink-0 stg:rounded stg:bg-muted stg:px-1.5 stg:py-0.5 stg:text-[10px] stg:font-medium stg:text-muted-foreground">
                {kindLabel}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
});

/**
 * Maps a WorkflowTaskKind enum value to its string representation
 * matching the TaskKindDescriptor's `kind` field.
 */
function kindEnumToString(kind: WorkflowTaskKind): string {
  const entry = Object.entries(WorkflowTaskKind).find(
    ([, v]) => v === kind && typeof v === "number",
  );
  return entry?.[0] ?? "";
}

function formatKindName(kind: WorkflowTaskKind): string {
  const str = kindEnumToString(kind);
  return str
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Renders a task kind icon by name. Uses simple SVG placeholders --
 * the full Lucide icon set is intentionally avoided in the SDK to
 * keep the bundle size minimal (DD-004).
 */
function TaskKindIcon({
  iconName,
  className,
}: {
  readonly iconName: string;
  readonly className?: string;
}) {
  return (
    <span
      className={cn("stg:inline-flex stg:items-center stg:justify-center", className)}
      title={iconName}
      aria-hidden="true"
    >
      <TaskDotIcon />
    </span>
  );
}

function TaskDotIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="8" cy="8" r="3" />
      <path d="M8 2v3M8 11v3M2 8h3M11 8h3" />
    </svg>
  );
}
