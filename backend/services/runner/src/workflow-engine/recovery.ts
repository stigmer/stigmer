/**
 * Recovery context types and builder for task-level resume.
 *
 * When the workflow engine starts in recovery mode, it loads the
 * previous run's completed task data and builds a RecoveryContext.
 * The executor uses this context to skip already-completed tasks,
 * restoring their outputs to $context and $output without re-executing.
 *
 * SANDBOX-SAFE: This module runs inside the Temporal deterministic V8
 * isolate. No Node.js built-ins, no crypto, no fs, no non-deterministic
 * operations. Only pure TypeScript data transformation.
 */

/**
 * Plain-object representation of a task's status and output, suitable
 * for crossing the Temporal serialization boundary (activity → sandbox).
 *
 * The LoadRecoveryContext activity converts proto WorkflowTask objects
 * into this shape before returning to the workflow sandbox.
 */
export interface RecoveryTaskData {
  readonly taskName: string;
  readonly status: string;
  readonly output: unknown;
}

/**
 * A single task's recovered state: its cached output and whether
 * that output was truncated by the 64KB status snapshot limit.
 */
export interface RecoveredTask {
  readonly output: unknown;
  readonly isTruncated: boolean;
}

/**
 * Recovery context built from the previous run's status snapshot.
 * Keyed by task name, contains only tasks that fully completed.
 *
 * ReadonlyMap prevents accidental mutation during the skip loop.
 */
export interface RecoveryContext {
  readonly completedTasks: ReadonlyMap<string, RecoveredTask>;
}

/**
 * Detects whether a value is a truncation marker produced by
 * {@link truncatePayload} when the serialized output exceeded
 * MAX_PAYLOAD_BYTES (64KB).
 */
function isTruncatedOutput(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  return (value as Record<string, unknown>)._truncated === true;
}

/**
 * Builds a RecoveryContext from the previous run's status.tasks[] data.
 *
 * Filters to tasks with status "completed" and detects truncated outputs.
 * When duplicate task names are present (e.g., from nested for-loop
 * iterations sharing a name with a top-level task), the last entry wins
 * — matching the TaskStatusAccumulator's last-write-wins behavior.
 *
 * @param tasks - Plain-object task data from LoadRecoveryContext activity.
 * @returns A RecoveryContext with completed tasks keyed by name.
 */
export function buildRecoveryContext(tasks: RecoveryTaskData[]): RecoveryContext {
  const completedTasks = new Map<string, RecoveredTask>();

  for (const task of tasks) {
    if (task.status !== "completed") continue;

    completedTasks.set(task.taskName, {
      output: task.output,
      isTruncated: isTruncatedOutput(task.output),
    });
  }

  return { completedTasks };
}
