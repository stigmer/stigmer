"use client";

import { useMemo } from "react";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { TodoItem } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { TodoStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { cn } from "@stigmer/theme";
import { ExecutionPhaseBadge } from "./ExecutionPhaseBadge";

export interface ExecutionProgressProps {
  /** The execution to display progress for. Renders nothing when null. */
  readonly execution: AgentExecution | null;
  readonly className?: string;
}

const STATUS_SORT_ORDER: ReadonlyMap<TodoStatus, number> = new Map([
  [TodoStatus.TODO_IN_PROGRESS, 0],
  [TodoStatus.TODO_PENDING, 1],
  [TodoStatus.TODO_COMPLETED, 2],
  [TodoStatus.TODO_CANCELLED, 3],
]);

function todoSortKey(item: TodoItem): number {
  return STATUS_SORT_ORDER.get(item.status) ?? 4;
}

/**
 * Displays execution lifecycle phase and, when present, the agent's
 * todo checklist showing multi-step task progress.
 *
 * The phase badge is always visible so the user knows the execution
 * state at a glance. When the agent creates todo items (via the
 * `write_todos` tool), they appear as a compact checklist sorted by
 * activity: in-progress items first, then pending, completed, and
 * cancelled.
 *
 * Renders its content without card chrome (no border, background, or
 * elevation). The consumer controls the container styling.
 *
 * All visual properties flow through `--stgm-*` tokens.
 *
 * @example
 * ```tsx
 * const stream = useExecutionStream(executionId);
 *
 * <div className="rounded-lg border border-border bg-card p-3">
 *   <ExecutionProgress execution={stream.execution} />
 * </div>
 * ```
 */
export function ExecutionProgress({
  execution,
  className,
}: ExecutionProgressProps) {
  if (!execution) return null;

  const phase = execution.status?.phase;
  if (phase === undefined) return null;

  const todos = execution.status?.todos;

  const sortedTodos = useMemo(() => {
    if (!todos) return [];
    const items = Object.values(todos);
    if (items.length === 0) return [];
    return items.slice().sort((a, b) => todoSortKey(a) - todoSortKey(b));
  }, [todos]);

  return (
    <div
      className={cn("flex flex-col gap-2", className)}
      role="region"
      aria-label="Execution progress"
    >
      <ExecutionPhaseBadge phase={phase} />
      {sortedTodos.length > 0 && (
        <ul role="list" className="flex flex-col gap-1" aria-label="Tasks">
          {sortedTodos.map((item) => (
            <TodoRow key={item.id} item={item} />
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Internal sub-components
// ---------------------------------------------------------------------------

function TodoRow({ item }: { item: TodoItem }) {
  const Icon = TODO_ICONS[item.status] ?? TodoPendingIcon;
  const colorClass = TODO_COLORS[item.status] ?? "text-muted-foreground";
  const cancelled = item.status === TodoStatus.TODO_CANCELLED;

  return (
    <li className="flex items-start gap-1.5 text-xs">
      <span className={cn("mt-0.5 shrink-0", colorClass)} aria-hidden="true">
        <Icon />
      </span>
      <span
        className={cn(
          "min-w-0 break-words",
          cancelled ? "text-muted-foreground line-through" : "text-foreground",
        )}
      >
        {item.content}
      </span>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Status icon mapping
// ---------------------------------------------------------------------------

const TODO_ICONS: Partial<Record<TodoStatus, () => React.JSX.Element>> = {
  [TodoStatus.TODO_PENDING]: TodoPendingIcon,
  [TodoStatus.TODO_IN_PROGRESS]: TodoInProgressIcon,
  [TodoStatus.TODO_COMPLETED]: TodoCompletedIcon,
  [TodoStatus.TODO_CANCELLED]: TodoCancelledIcon,
};

const TODO_COLORS: Partial<Record<TodoStatus, string>> = {
  [TodoStatus.TODO_PENDING]: "text-muted-foreground",
  [TodoStatus.TODO_IN_PROGRESS]: "text-foreground",
  [TodoStatus.TODO_COMPLETED]: "text-success",
  [TodoStatus.TODO_CANCELLED]: "text-muted-foreground",
};

// ---------------------------------------------------------------------------
// Inline SVG icons — no external icon dependency in SDK
// ---------------------------------------------------------------------------

function TodoPendingIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <circle cx="6" cy="6" r="4.5" />
    </svg>
  );
}

function TodoInProgressIcon() {
  return (
    <span className="relative flex h-3 w-3 items-center justify-center">
      <span className="absolute inline-flex h-2 w-2 animate-ping rounded-full bg-current opacity-75" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-current" />
    </span>
  );
}

function TodoCompletedIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2.5 6L5 8.5L9.5 3.5" />
    </svg>
  );
}

function TodoCancelledIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 3L9 9M9 3L3 9" />
    </svg>
  );
}
