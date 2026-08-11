"use client";

import { useMemo, type ComponentType } from "react";
import type { TodoItem } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/todo_pb";
import { TodoStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { cn } from "@stigmer/theme";

/** Props for {@link TodoList}. */
export interface TodoListProps {
  /**
   * Todo items keyed by ID. Accepts the proto map shape directly
   * (`execution.status.todos` or `subAgentExecution.todos`).
   */
  readonly todos: { readonly [key: string]: TodoItem };
  /** Additional CSS class names for the root container. */
  readonly className?: string;
  /**
   * Replacement row component. Receives {@link TodoRowProps} for each
   * item; defaults to the built-in {@link TodoRow}. Renders inside a
   * `<ul role="list">`, so the component must produce an `<li>`.
   */
  readonly TodoRow?: ComponentType<TodoRowProps>;
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
 * Renders a sorted checklist of {@link TodoItem} entries.
 *
 * Shared by {@link ExecutionProgress} (main agent sidebar widget)
 * and {@link SubAgentSection} (sub-agent expanded content).
 *
 * Items are sorted by activity: in-progress first, then pending,
 * completed, and cancelled. Each row shows a status icon and the
 * task description.
 *
 * All visual properties flow through `--stgm-*` tokens.
 *
 * @example
 * ```tsx
 * const execution = stream.execution;
 * const todos = execution?.status?.todos ?? {};
 *
 * <TodoList todos={todos} />
 * ```
 */
export function TodoList({
  todos,
  className,
  TodoRow: RowComponent = TodoRow,
}: TodoListProps) {
  const sortedTodos = useMemo(() => {
    const items = Object.values(todos);
    if (items.length === 0) return [];
    return items.slice().sort((a, b) => todoSortKey(a) - todoSortKey(b));
  }, [todos]);

  if (sortedTodos.length === 0) return null;

  return (
    <ul
      role="list"
      className={cn("stg:flex stg:flex-col stg:gap-1", className)}
      aria-label="Tasks"
    >
      {sortedTodos.map((item) => (
        <RowComponent key={item.id} item={item} />
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Exported for reuse in collapsed sub-agent preview
// ---------------------------------------------------------------------------

/**
 * Returns the first in-progress todo from a todos map, or `null`.
 * Used by {@link SubAgentSection} to show an active task preview
 * in the collapsed summary row.
 */
export function findActiveTodo(
  todos: { readonly [key: string]: TodoItem } | undefined,
): TodoItem | null {
  if (!todos) return null;
  for (const item of Object.values(todos)) {
    if (item.status === TodoStatus.TODO_IN_PROGRESS) return item;
  }
  return null;
}

/**
 * Builds a compact completion summary string (e.g. "3/5 completed").
 * Returns `null` when there are no todos.
 */
export function todoCompletionSummary(
  todos: { readonly [key: string]: TodoItem } | undefined,
): string | null {
  if (!todos) return null;
  const items = Object.values(todos);
  if (items.length === 0) return null;
  const completed = items.filter(
    (t) => t.status === TodoStatus.TODO_COMPLETED,
  ).length;
  return `${completed}/${items.length} completed`;
}

// ---------------------------------------------------------------------------
// TodoRow — single todo item with status icon
// ---------------------------------------------------------------------------

/** Props for {@link TodoRow}. */
export interface TodoRowProps {
  /** The todo item to render. */
  readonly item: TodoItem;
}

/**
 * One to-do checklist row: status icon plus task description, rendered as
 * an `<li>`. The default row for {@link TodoList} — replace it via the
 * `TodoRow` prop (or `MessageThread`'s `slots.TodoRow`) to restyle rows or
 * bring host iconography while keeping the built-in card chrome.
 */
export function TodoRow({ item }: TodoRowProps) {
  const Icon = TODO_ICONS[item.status] ?? TodoPendingIcon;
  const colorClass = TODO_COLORS[item.status] ?? "stg:text-muted-foreground";
  const cancelled = item.status === TodoStatus.TODO_CANCELLED;

  return (
    <li className="stg:flex stg:items-start stg:gap-1.5 stg:text-xs">
      <span className={cn("stg:mt-0.5 stg:shrink-0", colorClass)} aria-hidden="true">
        <Icon />
      </span>
      <span
        className={cn(
          "stg:min-w-0 stg:break-words",
          cancelled ? "stg:text-muted-foreground stg:line-through" : "stg:text-foreground",
        )}
      >
        {item.content}
      </span>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Status icon / color mapping
// ---------------------------------------------------------------------------

const TODO_ICONS: Partial<Record<TodoStatus, () => React.JSX.Element>> = {
  [TodoStatus.TODO_PENDING]: TodoPendingIcon,
  [TodoStatus.TODO_IN_PROGRESS]: TodoInProgressIcon,
  [TodoStatus.TODO_COMPLETED]: TodoCompletedIcon,
  [TodoStatus.TODO_CANCELLED]: TodoCancelledIcon,
};

const TODO_COLORS: Partial<Record<TodoStatus, string>> = {
  [TodoStatus.TODO_PENDING]: "stg:text-muted-foreground",
  [TodoStatus.TODO_IN_PROGRESS]: "stg:text-foreground",
  [TodoStatus.TODO_COMPLETED]: "stg:text-success",
  [TodoStatus.TODO_CANCELLED]: "stg:text-muted-foreground",
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

/** Exported for reuse in SubAgentSection collapsed preview. */
export function TodoInProgressIcon() {
  return (
    <span className="stg:relative stg:flex stg:h-3 stg:w-3 stg:items-center stg:justify-center">
      <span className="stg:absolute stg:inline-flex stg:h-2 stg:w-2 stg:animate-ping stg:rounded-full stg:bg-current stg:opacity-75" />
      <span className="stg:relative stg:inline-flex stg:h-2 stg:w-2 stg:rounded-full stg:bg-current" />
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
