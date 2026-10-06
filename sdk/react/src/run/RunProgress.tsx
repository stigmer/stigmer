"use client";

import type { AgentRun } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/api_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/enum_pb";
import { cn } from "@stigmer/theme";
import { RunPhaseBadge } from "./RunPhaseBadge.js";
import { TodoList } from "./TodoList.js";

/** Props for {@link RunProgress}. */
export interface RunProgressProps {
  /** The run to display progress for. Renders nothing when null. */
  readonly run: AgentRun | null;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Displays run lifecycle phase and, when present, the agent's
 * todo checklist showing multi-step task progress.
 *
 * The phase badge is always visible so the user knows the run
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
 * const stream = useRunStream(executionId);
 *
 * <div className="rounded-lg border border-border bg-card p-3">
 *   <RunProgress run={stream.execution} />
 * </div>
 * ```
 */
export function RunProgress({
  run: execution,
  className,
}: RunProgressProps) {
  if (!execution) return null;

  const phase = execution.status?.phase;
  if (phase === undefined) return null;

  const todos = execution.status?.todos;
  // Populated by the server on RUN_FAILED and RUN_TERMINATED —
  // surface it next to the badge so this widget explains a failure rather
  // than showing a bare phase (consistent with the message thread).
  //
  // CANCELLED is carved out: cancel is a quiet terminal state, not a failure
  // (stigmer#282). A CANCELLED run can still carry a non-empty error —
  // cancel preserves a preexisting error by design, and an older server may
  // have written a cancellation sentinel — so the phase, not the error field,
  // decides whether to render the alert. The muted Cancelled badge suffices.
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
