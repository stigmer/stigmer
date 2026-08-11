"use client";

import { memo, useMemo, type ComponentType } from "react";
import type { TodoItem } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/todo_pb";
import { TodoStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { cn } from "@stigmer/theme";
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
   * The agent's todo map for one execution — the proto map shape
   * (`execution.status.todos`) passed through by reference so a settled
   * card skips re-renders while siblings stream (DD-009/010).
   */
  readonly todos: { readonly [key: string]: TodoItem };
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
 * sub-agent section renders bare, so there is exactly one todo renderer and no
 * card-in-a-card.
 *
 * Disclosure follows the thread's {@link useAutoDisclosure} convention: open
 * while the plan is active (any item in progress), settling closed once the
 * plan is fully resolved, with a user's manual toggle always winning. This
 * keeps an in-flight plan visible and a finished one tidy, mirroring
 * `ToolRunGroup`/{@link SubAgentSection}.
 *
 * `React.memo`'d on the by-reference `todos` map: structural sharing
 * (`shareTodos`) keeps the reference stable across stream frames, so the card
 * re-renders only when the plan actually changes — never per frame.
 *
 * All visual properties flow through `--stgm-*` tokens.
 *
 * @example
 * ```tsx
 * <TodoCard todos={execution.status?.todos ?? {}} />
 * ```
 */
export const TodoCard = memo(function TodoCard({
  todos,
  className,
  TodoRow,
}: TodoCardProps) {
  useRenderTracer("TodoCard", { todos });

  const count = Object.keys(todos).length;
  const isActive = findActiveTodo(todos) != null;
  const summary = todoCompletionSummary(todos);
  const allDone = useMemo(
    () =>
      count > 0 &&
      Object.values(todos).every(
        (t) =>
          t.status === TodoStatus.TODO_COMPLETED ||
          t.status === TodoStatus.TODO_CANCELLED,
      ),
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
            allDone ? "stg:text-success" : "stg:text-muted-foreground",
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
 * Shallow comparator for {@link TodoCardProps}. The `todos` map is kept
 * referentially stable by `shareTodos`, so an identity check is exactly the
 * right (and cheapest) "did the plan change?" test.
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
