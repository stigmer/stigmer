"use client";

import { useMemo, type ComponentType } from "react";
import type { Todo } from "@stigmer/client";
import { cn } from "@stigmer/design-tokens";
import { UNSTYLED_LIST } from "../internal/element-resets.js";
import { SpinnerIcon } from "../internal/thread-card/index.js";

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
 * Renders a sorted checklist of `Todo` entries, in the look of a turn's
 * plan card ({@link PlanSteps}): 14/20 rows with 8px padding split by a
 * muted rule, each with the plan's mark (a ready tick once done, a running
 * spinner while in progress, an empty ring before, a ring and struck words
 * once dropped).
 *
 * The list inside {@link TodoCard}, which a host's `TodoCard` or `TodoRow`
 * slot on `MessageThread` brings in place of the plan card.
 *
 * Items are sorted by activity: in-progress first, then pending,
 * completed, and cancelled.
 *
 * All visual properties flow through `--stgm-*` tokens.
 *
 * @example
 * ```tsx
 * import type { Turn } from "@stigmer/client";
 *
 * function TurnTodos({ turn }: { turn: Turn }) {
 *   return <TodoList todos={turn.todos} />;
 * }
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
      className={cn(UNSTYLED_LIST, className)}
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
 * One to-do checklist row: the plan's mark plus the task description,
 * rendered as an `<li>` in the plan card's row look. The default row for
 * {@link TodoList} — replace it via the `TodoRow` prop (or
 * `MessageThread`'s `slots.TodoRow`) to restyle rows or bring host
 * iconography while keeping the built-in card chrome.
 */
export function TodoRow({ item }: TodoRowProps) {
  const status = item.status;
  return (
    <li className="stg:flex stg:items-start stg:gap-2 stg:border-b stg:border-border-muted stg:px-3 stg:py-2 stg:text-sm stg:last:border-b-0">
      <TodoMark status={status} />
      <span
        className={cn(
          "stg:min-w-0 stg:flex-1 stg:break-words",
          (status === "completed" || status === "pending") && "stg:text-muted-foreground",
          status === "cancelled" && "stg:text-muted-foreground stg:line-through",
          status === "in_progress" && "stg:font-medium stg:text-foreground",
        )}
      >
        {item.content}
      </span>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Marks: the plan card's (PlanSteps) tick, spinner and ring
// ---------------------------------------------------------------------------

/** A row's mark: a ready tick once done, a running spinner while in progress, an empty ring before or once dropped. */
function TodoMark({ status }: { readonly status: Todo["status"] }) {
  if (status === "completed") {
    return (
      <span aria-label="Done" role="img" className="stg:mt-0.5 stg:flex stg:h-4 stg:w-4 stg:shrink-0 stg:items-center stg:justify-center stg:rounded-full stg:bg-status-ready stg:text-background">
        <svg viewBox="0 0 12 12" className="stg:h-2.5 stg:w-2.5" aria-hidden="true">
          <path d="M2.5 6.5 5 9l4.5-5.5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }
  if (status === "in_progress") {
    return (
      <span aria-label="In progress" role="img" className="stg:mt-0.5 stg:flex stg:h-4 stg:w-4 stg:shrink-0 stg:items-center stg:justify-center stg:text-status-running">
        <TodoInProgressIcon />
      </span>
    );
  }
  return (
    <span
      aria-label={status === "cancelled" ? "Dropped" : "To do"}
      role="img"
      className="stg:mt-0.5 stg:h-4 stg:w-4 stg:shrink-0 stg:rounded-full stg:border stg:border-border"
    />
  );
}

/**
 * The in-progress glyph (the plan card's spinner, drawn in the current
 * colour), exported for hosts composing their own to-do rows.
 */
export function TodoInProgressIcon() {
  return <SpinnerIcon />;
}
