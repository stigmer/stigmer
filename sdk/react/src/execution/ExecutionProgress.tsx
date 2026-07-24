"use client";

import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { cn } from "@stigmer/theme";
import { ExecutionPhaseBadge } from "./ExecutionPhaseBadge.js";
import { TodoList } from "./TodoList.js";

/** Props for {@link ExecutionProgress}. */
export interface ExecutionProgressProps {
  /** The execution to display progress for. Renders nothing when null. */
  readonly execution: AgentExecution | null;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
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
  // Populated by the server on EXECUTION_FAILED and EXECUTION_TERMINATED —
  // surface it next to the badge so this widget explains a failure rather
  // than showing a bare phase (consistent with the message thread).
  //
  // CANCELLED is carved out: cancel is a quiet terminal state, not a failure
  // (stigmer#282). A CANCELLED execution can still carry a non-empty error —
  // cancel preserves a preexisting error by design, and an older server may
  // have written a cancellation sentinel — so the phase, not the error field,
  // decides whether to render the alert. The muted Cancelled badge suffices.
  const error =
    phase === ExecutionPhase.EXECUTION_CANCELLED
      ? undefined
      : execution.status?.error;

  return (
    <div
      className={cn("flex flex-col gap-2", className)}
      role="region"
      aria-label="Execution progress"
    >
      <ExecutionPhaseBadge phase={phase} />
      {error && (
        <p
          role="alert"
          className="text-xs whitespace-pre-wrap break-words text-destructive"
        >
          {error}
        </p>
      )}
      {todos && <TodoList todos={todos} />}
    </div>
  );
}
