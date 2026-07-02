"use client";

import { memo, useMemo } from "react";
import type { TodoItem } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/todo_pb";
import { TodoStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { cn } from "@stigmer/theme";
import { useRenderTracer } from "../internal/dev";
import { useAutoDisclosure } from "../internal/useAutoDisclosure";
import { TodoList, findActiveTodo, todoCompletionSummary } from "./TodoList";

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
        "rounded-lg border border-border-prominent overflow-hidden",
        className,
      )}
    >
      <button
        type="button"
        aria-expanded={expanded}
        onClick={handleToggle}
        className={cn(
          "flex w-full cursor-pointer items-center gap-2 px-2.5 py-1.5 text-left text-xs text-muted-foreground transition-colors",
          "hover:bg-muted-subtle",
          // ring-inset so the card's overflow-hidden does not clip the focus ring.
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        )}
      >
        <span
          className={cn(
            "shrink-0",
            allDone ? "text-success" : "text-muted-foreground",
          )}
          aria-hidden="true"
        >
          <PlanIcon />
        </span>
        <span className="min-w-0 flex-1 truncate font-medium text-foreground">
          To-dos
        </span>
        {summary && (
          <span className="shrink-0 tabular-nums text-muted-foreground">
            {summary}
          </span>
        )}
        <ChevronIcon expanded={expanded} />
      </button>

      {expanded && (
        <div className="border-t border-border-muted px-2.5 py-2">
          <TodoList todos={todos} />
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
  return prev.todos === next.todos && prev.className === next.className;
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
        "shrink-0 text-muted-foreground transition-transform duration-150",
        expanded && "rotate-90",
      )}
      aria-hidden="true"
    >
      <path d="M3.5 2L6.5 5L3.5 8" />
    </svg>
  );
}
