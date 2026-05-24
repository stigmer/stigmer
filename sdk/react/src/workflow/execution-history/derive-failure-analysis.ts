import type { WorkflowExecution } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import {
  ExecutionPhase,
  WorkflowTaskStatus,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";

/**
 * A single failed execution reference within a {@link FailureGroup}.
 */
export interface FailureInstance {
  readonly executionId: string;
  readonly executionName: string;
  readonly error: string;
  readonly failedAt: Date | null;
}

/**
 * A group of failures sharing the same failing task name.
 *
 * Sorted by {@link count} descending so the most frequent failures
 * appear first in the failure analysis panel.
 */
export interface FailureGroup {
  /** The task name that failed across multiple executions. */
  readonly taskName: string;
  /** Number of executions where this task failed. */
  readonly count: number;
  /** Most recent error message from this task. */
  readonly latestError: string;
  /** Timestamp of the most recent failure. */
  readonly latestFailedAt: Date | null;
  /** Individual failed execution references (most recent first). */
  readonly instances: readonly FailureInstance[];
}

function parseDate(iso: string | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Groups failed executions by their failing task name.
 *
 * Pure function. Only considers executions in FAILED phase. Within each
 * execution, finds the first FAILED task and groups by its name. Executions
 * with no identifiable failed task are grouped under `"(unknown)"`.
 *
 * Returns groups sorted by failure count descending, with instances
 * within each group sorted by failure time descending (most recent first).
 */
export function deriveFailureAnalysis(
  executions: readonly WorkflowExecution[],
): FailureGroup[] {
  const groupMap = new Map<string, {
    taskName: string;
    instances: FailureInstance[];
  }>();

  for (const exec of executions) {
    if (exec.status?.phase !== ExecutionPhase.EXECUTION_FAILED) continue;

    const tasks = exec.status?.tasks ?? [];
    let failedTaskName = "(unknown)";
    let taskError = exec.status?.error || "";

    for (const task of tasks) {
      if (task.status === WorkflowTaskStatus.WORKFLOW_TASK_FAILED) {
        failedTaskName = task.taskName || "(unknown)";
        taskError = task.error || exec.status?.error || "";
        break;
      }
    }

    const instance: FailureInstance = {
      executionId: exec.metadata?.id ?? "",
      executionName: exec.metadata?.name || exec.metadata?.slug || "",
      error: taskError,
      failedAt: parseDate(exec.status?.completedAt),
    };

    let group = groupMap.get(failedTaskName);
    if (!group) {
      group = { taskName: failedTaskName, instances: [] };
      groupMap.set(failedTaskName, group);
    }
    group.instances.push(instance);
  }

  const groups: FailureGroup[] = [];

  for (const group of groupMap.values()) {
    const sorted = [...group.instances].sort((a, b) => {
      const ta = a.failedAt?.getTime() ?? 0;
      const tb = b.failedAt?.getTime() ?? 0;
      return tb - ta;
    });

    groups.push({
      taskName: group.taskName,
      count: sorted.length,
      latestError: sorted[0]?.error ?? "",
      latestFailedAt: sorted[0]?.failedAt ?? null,
      instances: sorted,
    });
  }

  groups.sort((a, b) => b.count - a.count);

  return groups;
}
