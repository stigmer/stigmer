"use client";

import { useMemo } from "react";
import type { WorkflowExecutionEvent } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/event_pb";
import type { WorkflowTask } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import type { DerivedTaskState } from "../../internal/store/workflow-execution-event-store.js";
import { deriveTaskDetail, type TaskDetail } from "./derive-task-detail.js";

/** Return value of {@link useExecutionTaskDetail}. */
export interface UseExecutionTaskDetailReturn {
  /** Rich per-task detail, or `null` when no task is selected or no data exists. */
  readonly detail: TaskDetail | null;
}

/**
 * Data hook that derives rich per-task detail for the runtime inspector.
 *
 * Joins the event stream (for timeline data) with the execution status
 * snapshot (for full I/O) to produce a `TaskDetail` for the selected task.
 *
 * Returns `null` when `selectedTaskName` is null or no data exists for
 * the selected task.
 *
 * @example
 * ```tsx
 * const { detail } = useExecutionTaskDetail({
 *   selectedTaskName: "classify_input",
 *   events,
 *   taskStates,
 *   taskSnapshots: execution?.status?.tasks,
 * });
 * if (detail) {
 *   // Render tabs based on detail.input, detail.error, etc.
 * }
 * ```
 */
export function useExecutionTaskDetail(options: {
  readonly selectedTaskName: string | null;
  readonly events: readonly WorkflowExecutionEvent[];
  readonly taskStates: ReadonlyMap<string, DerivedTaskState>;
  readonly taskSnapshots?: readonly WorkflowTask[];
}): UseExecutionTaskDetailReturn {
  const { selectedTaskName, events, taskStates, taskSnapshots } = options;

  const detail = useMemo((): TaskDetail | null => {
    if (!selectedTaskName) return null;

    const snapshot = taskSnapshots?.find((t) => t.taskName === selectedTaskName);
    const derived = taskStates.get(selectedTaskName);

    return deriveTaskDetail(selectedTaskName, events, snapshot, derived);
  }, [selectedTaskName, events, taskStates, taskSnapshots]);

  return { detail };
}
