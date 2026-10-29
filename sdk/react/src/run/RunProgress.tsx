"use client";

import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import type { Todo } from "@stigmer/client";
import { cn } from "@stigmer/design-tokens";
import { RunPhaseBadge } from "./RunPhaseBadge.js";
import { TodoList } from "./TodoList.js";

/** Props for {@link RunProgress}. */
export interface RunProgressProps {
  /** The run to display progress for: its phase and error. Renders nothing when null. */
  readonly run: Run | null;
  /**
   * The turn's to-do list, from the session's fold (`Turn.todos`); omitted
   * or empty shows none.
   */
  readonly todos?: readonly Todo[];
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Displays run lifecycle phase and, when present, the agent's
 * todo checklist showing multi-step task progress.
 *
 * The phase badge is always visible so the user knows the run
 * state at a glance. When the agent keeps a to-do list (`todos`, from
 * the turn's fold), it appears as a compact checklist sorted by
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
 * <div className="rounded-lg border border-border bg-card p-3">
 *   <RunProgress run={run} todos={turn.todos} />
 * </div>
 * ```
 */
export function RunProgress({
  run: execution,
  todos,
  className,
}: RunProgressProps) {
  if (!execution) return null;

  const phase = execution.status?.phase;
  if (phase === undefined) return null;

  // Populated by the server on RUN_FAILED and RUN_TERMINATED —
  // surface it next to the badge so this widget explains a failure rather
  // than showing a bare phase (consistent with the message thread).
  //
  // CANCELLED is carved out: cancel is a quiet terminal state, not a failure
  // (stigmer#282). A CANCELLED run can still carry a non-empty error —
  // cancel preserves a preexisting error by design — so the phase, not the
  // error field, decides whether to render the alert. The muted Cancelled badge suffices.
  const error =
    phase === RunPhase.RUN_CANCELLED
      ? undefined
      : execution.status?.error;

  return (
    <div
      className={cn("stg:flex stg:flex-col stg:gap-2", className)}
      role="region"
      aria-label="Run progress"
    >
      <RunPhaseBadge phase={phase} />
      {error && (
        <p
          role="alert"
          className="stg:text-xs stg:whitespace-pre-wrap stg:break-words stg:text-destructive"
        >
          {error}
        </p>
      )}
      {todos && <TodoList todos={todos} />}
    </div>
  );
}
