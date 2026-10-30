"use client";

import { memo, useMemo, type ComponentType } from "react";
import type { Todo } from "@stigmer/client";
import { cn } from "@stigmer/design-tokens";
import { useRenderTracer } from "../internal/dev/index.js";
import { useAutoDisclosure } from "../internal/useAutoDisclosure.js";
import {
  TodoList,
  findActiveTodo,
  todoCompletionSummary,
  type TodoRowProps,
} from "./TodoList.js";

/** Props for {@link TodoCard}. */
export interface TodoCardProps {
  /**
   * The agent's to-do list for one turn (`Turn.todos`), passed through by
   * reference so a settled card skips re-renders while siblings stream.
   */
  readonly todos: readonly Todo[];
  /** Additional CSS class names for the root container. */
  readonly className?: string;
  /**
   * Replacement row component, forwarded to the inner {@link TodoList}.
   * Lets a host restyle individual rows while keeping the card's
   * collapse/progress chrome. Defaults to the built-in {@link TodoRow}.
   */
  readonly TodoRow?: ComponentType<TodoRowProps>;
}

/**
 * The agent's plan, rendered inline in the message thread as a collapsible
 * card — the Cursor-style "what I'm going to do, and how far I've got"
 * surface. It is the in-thread home of the todo list that previously lived
 * in the right-side Plan tab.
 *
 * The card chrome matches the rest of the thread's tool cards (a single
 * neutral {@link https://tailwindcss.com `border-border-prominent`} line) and
 * wraps the chrome-less {@link TodoList} primitive — the same list the
 * subagent section renders bare, so there is exactly one todo renderer and no
 * card-in-a-card.
 *
 * Disclosure follows the thread's {@link useAutoDisclosure} convention: open
 * while the plan is active (any item in progress), settling closed once the
 * plan is fully resolved, with a user's manual toggle always winning. This
 * keeps an in-flight plan visible and a finished one tidy, mirroring
 * `ToolRunGroup`/{@link SubagentSection}.
 *
 * `React.memo`'d on the by-reference `todos` list: the session fold rebuilds
 * a turn's list only when the turn changes, so the card re-renders on turn
 * updates, never per preview frame of another turn.
 *
 * All visual properties flow through `--stgm-*` tokens.
 *
 * @example
 * ```tsx
 * <TodoCard todos={turn.todos} />
 * ```
 */
export const TodoCard = memo(function TodoCard({
  todos,
  className,
  TodoRow,
}: TodoCardProps) {
  useRenderTracer("TodoCard", { todos });

  const count = todos.length;
  const isActive = findActiveTodo(todos) != null;
  const summary = todoCompletionSummary(todos);
  const allDone = useMemo(
    () =>
      count > 0 &&
      todos.every((t) => t.status === "completed" || t.status === "cancelled"),
    [todos, count],
  );

  // Open while the plan is being worked, tidy once it is fully resolved; a
  // manual toggle wins for the card's lifetime. A completed plan in session
  // history therefore renders collapsed.
  const [expanded, handleToggle] = useAutoDisclosure(isActive);

  // buildThreadItems only emits this item when todos exist, but guard anyway
  // so the component is safe to use standalone.
  if (count === 0) return null;

  return (
    <div
      role="region"
      aria-label="Agent to-dos"
      data-cursor-target="todo-card"
      className={cn(
        "stg:rounded-lg stg:border stg:border-border-prominent stg:overflow-hidden",
        className,
      )}
    >
      <button
        type="button"
        aria-expanded={expanded}
        onClick={handleToggle}
        className={cn(
          "stg:flex stg:w-full stg:cursor-pointer stg:items-center stg:gap-2 stg:px-2.5 stg:py-1.5 stg:text-left stg:text-xs stg:text-muted-foreground stg:transition-colors",
          "stg:hover:bg-muted-subtle",
          // ring-inset so the card's overflow-hidden does not clip the focus ring.
          "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-inset stg:focus-visible:ring-ring",
        )}
      >
        <span
          className={cn(
            "stg:shrink-0",
            allDone ? "stg:text-status-ready" : "stg:text-muted-foreground",
          )}
          aria-hidden="true"
        >
          <PlanIcon />
        </span>
        <span className="stg:min-w-0 stg:flex-1 stg:truncate stg:font-medium stg:text-foreground">
          To-dos
        </span>
        {summary && (
          <span className="stg:shrink-0 stg:tabular-nums stg:text-muted-foreground">
            {summary}
          </span>
        )}
        <ChevronIcon expanded={expanded} />
      </button>

      {expanded && (
        <div className="stg:border-t stg:border-border-muted stg:px-2.5 stg:py-2">
          <TodoList todos={todos} TodoRow={TodoRow} />
        </div>
      )}
    </div>
  );
}, todoCardPropsEqual);

/**
 * Shallow comparator for {@link TodoCardProps}. The `todos` list keeps its
 * reference while its turn is unchanged, so an identity check is the
 * cheapest "did the plan change?" test.
 *
 * @internal Exported for testing — not part of the public API.
 */
export function todoCardPropsEqual(
  prev: Readonly<TodoCardProps>,
  next: Readonly<TodoCardProps>,
): boolean {
  return (
    prev.todos === next.todos &&
    prev.className === next.className &&
    prev.TodoRow === next.TodoRow
  );
}

// ---------------------------------------------------------------------------
// Inline SVG icons — kept inline for SDK independence (codebase pattern)
// ---------------------------------------------------------------------------

function PlanIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 3h8M2 6h6M2 9h7" />
    </svg>
  );
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn(
        "stg:shrink-0 stg:text-muted-foreground stg:transition-transform stg:duration-150",
        expanded && "stg:rotate-90",
      )}
      aria-hidden="true"
    >
      <path d="M3.5 2L6.5 5L3.5 8" />
    </svg>
  );
}
