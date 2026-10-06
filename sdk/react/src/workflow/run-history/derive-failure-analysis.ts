import type { WorkflowRun } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/api_pb";
import {
  RunPhase,
  WorkflowTaskStatus,
} from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/enum_pb";

/**
 * A single failed run reference within a {@link FailureGroup}.
 */
export interface FailureInstance {
  readonly runId: string;
  readonly runName: string;
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
  /** The task name that failed across multiple runs. */
  readonly taskName: string;
  /** Number of runs where this task failed. */
  readonly count: number;
  /** Most recent error message from this task. */
  readonly latestError: string;
  /** Timestamp of the most recent failure. */
  readonly latestFailedAt: Date | null;
  /** Individual failed run references (most recent first). */
  readonly instances: readonly FailureInstance[];
}

function parseDate(iso: string | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Groups failed runs by their failing task name.
 *
 * Pure function. Only considers runs in FAILED phase. Within each
 * run, finds the first FAILED task and groups by its name. Runs
 * with no identifiable failed task are grouped under `"(unknown)"`.
 *
 * Returns groups sorted by failure count descending, with instances
 * within each group sorted by failure time descending (most recent first).
 */
export function deriveFailureAnalysis(
  executions: readonly WorkflowRun[],
): FailureGroup[] {
  const groupMap = new Map<string, {
    taskName: string;
    instances: FailureInstance[];
  }>();

  for (const exec of executions) {
    if (exec.status?.phase !== RunPhase.RUN_FAILED) continue;

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
      runId: exec.metadata?.id ?? "",
      runName: exec.metadata?.name || exec.metadata?.slug || "",
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
