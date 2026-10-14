"use client";

import { useMemo, type ComponentType } from "react";
import type { Todo } from "@stigmer/sdk";
import { cn } from "@stigmer/theme";
import { UNSTYLED_LIST } from "../internal/element-resets.js";

/** Props for {@link TodoList}. */
export interface TodoListProps {
  /** The to-do items, as a turn's fold holds them (`Turn.todos`). */
  readonly todos: readonly Todo[];
  /** Additional CSS class names for the root container. */
  readonly className?: string;
  /**
   * Replacement row component. Receives {@link TodoRowProps} for each
   * item; defaults to the built-in {@link TodoRow}. Renders inside a
   * `<ul role="list">`, so the component must produce an `<li>`.
   */
  readonly TodoRow?: ComponentType<TodoRowProps>;
}

const STATUS_SORT_ORDER: Readonly<Record<Todo["status"], number>> = {
  in_progress: 0,
  pending: 1,
  completed: 2,
  cancelled: 3,
};

/**
 * Renders a sorted checklist of `Todo` entries.
 *
 * Shared by {@link RunProgress} (main agent sidebar widget)
 * and {@link TodoCard} (the in-thread card).
 *
 * Items are sorted by activity: in-progress first, then pending,
 * completed, and cancelled. Each row shows a status icon and the
 * task description.
 *
 * All visual properties flow through `--stgm-*` tokens.
 *
 * @example
 * ```tsx
 * <TodoList todos={turn.todos} />
 * ```
 */
export function TodoList({
  todos,
  className,
  TodoRow: RowComponent = TodoRow,
}: TodoListProps) {
  const sortedTodos = useMemo(
    () => todos.slice().sort((a, b) => STATUS_SORT_ORDER[a.status] - STATUS_SORT_ORDER[b.status]),
    [todos],
  );

  if (sortedTodos.length === 0) return null;

  return (
    <ul
      role="list"
      className={cn(UNSTYLED_LIST, "stg:flex stg:flex-col stg:gap-1", className)}
      aria-label="Tasks"
    >
      {sortedTodos.map((item) => (
        <RowComponent key={item.id} item={item} />
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Exported for reuse in collapsed subagent preview
// ---------------------------------------------------------------------------

/**
 * Returns the first in-progress to-do, or `null`. Used by {@link TodoCard} to
 * decide whether the plan is being worked.
 */
export function findActiveTodo(todos: readonly Todo[]): Todo | null {
  return todos.find((item) => item.status === "in_progress") ?? null;
}

/**
 * Builds a compact completion summary string (e.g. "3/5 completed").
 * Returns `null` when there are no to-dos.
 */
export function todoCompletionSummary(todos: readonly Todo[]): string | null {
  if (todos.length === 0) return null;
  const completed = todos.filter((t) => t.status === "completed").length;
  return `${completed}/${todos.length} completed`;
}

// ---------------------------------------------------------------------------
// TodoRow — single todo item with status icon
// ---------------------------------------------------------------------------

/** Props for {@link TodoRow}. */
export interface TodoRowProps {
  /** The to-do item to render. */
  readonly item: Todo;
}

/**
 * One to-do checklist row: status icon plus task description, rendered as
 * an `<li>`. The default row for {@link TodoList} — replace it via the
 * `TodoRow` prop (or `MessageThread`'s `slots.TodoRow`) to restyle rows or
 * bring host iconography while keeping the built-in card chrome.
 */
export function TodoRow({ item }: TodoRowProps) {
  const Icon = TODO_ICONS[item.status];
  const colorClass = TODO_COLORS[item.status];
  const cancelled = item.status === "cancelled";

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

const TODO_ICONS: Readonly<Record<Todo["status"], () => React.JSX.Element>> = {
  pending: TodoPendingIcon,
  in_progress: TodoInProgressIcon,
  completed: TodoCompletedIcon,
  cancelled: TodoCancelledIcon,
};

const TODO_COLORS: Readonly<Record<Todo["status"], string>> = {
  pending: "stg:text-muted-foreground",
  in_progress: "stg:text-foreground",
  completed: "stg:text-success",
  cancelled: "stg:text-muted-foreground",
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

/** The in-progress glyph, exported for hosts composing their own to-do rows. */
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
