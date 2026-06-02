import type { WorkflowExecution } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import type { WorkflowTask } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { WorkflowTaskStatus } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import { deriveExecutionRow } from "../execution-history/derive-execution-row";
import type { TaskComparison, ExecutionComparison } from "./types";

const BIGINT_ZERO = BigInt(0);

function parseIsoMs(iso: string | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}

function taskDurationMs(task: WorkflowTask): number | null {
  const start = parseIsoMs(task.startedAt);
  const end = parseIsoMs(task.completedAt);
  if (start == null || end == null) return null;
  return end - start;
}

function taskKindLabel(task: WorkflowTask): string {
  return task.taskType != null ? String(task.taskType) : "";
}

function indexTasksByName(
  tasks: readonly WorkflowTask[],
): ReadonlyMap<string, WorkflowTask> {
  const map = new Map<string, WorkflowTask>();
  for (const t of tasks) {
    if (t.taskName) {
      map.set(t.taskName, t);
    }
  }
  return map;
}

/**
 * Derives a structural comparison between two workflow executions.
 *
 * Pure function with zero side effects. Aligns tasks by `taskName`
 * (stable within the same workflow version) and computes deltas for
 * duration, cost, tokens, and status across all matched tasks.
 *
 * When workflow definitions differ between runs, unmatched tasks are
 * reported in `tasksOnlyInBase` and `tasksOnlyInCompare`.
 */
export function deriveExecutionComparison(
  base: WorkflowExecution,
  compare: WorkflowExecution,
): ExecutionComparison {
  const baseRow = deriveExecutionRow(base);
  const compareRow = deriveExecutionRow(compare);

  const baseTasks = base.status?.tasks ?? [];
  const compareTasks = compare.status?.tasks ?? [];

  const baseByName = indexTasksByName(baseTasks);
  const compareByName = indexTasksByName(compareTasks);

  const allNames = new Set<string>();
  baseByName.forEach((_v, name) => allNames.add(name));
  compareByName.forEach((_v, name) => allNames.add(name));

  const tasks: TaskComparison[] = [];
  const tasksOnlyInBase: string[] = [];
  const tasksOnlyInCompare: string[] = [];
  let divergencePoint: string | null = null;

  const orderedNames = Array.from(allNames).sort((a, b) => {
    const aIdx = baseTasks.findIndex((t) => t.taskName === a);
    const bIdx = baseTasks.findIndex((t) => t.taskName === b);
    const aOrder = aIdx >= 0 ? aIdx : compareTasks.findIndex((t) => t.taskName === a);
    const bOrder = bIdx >= 0 ? bIdx : compareTasks.findIndex((t) => t.taskName === b);
    return aOrder - bOrder;
  });

  for (const name of orderedNames) {
    const baseTask = baseByName.get(name);
    const compareTask = compareByName.get(name);

    if (baseTask && !compareTask) {
      tasksOnlyInBase.push(name);
      continue;
    }
    if (!baseTask && compareTask) {
      tasksOnlyInCompare.push(name);
      continue;
    }
    if (!baseTask || !compareTask) continue;

    const baseStatus = baseTask.status ?? WorkflowTaskStatus.WORKFLOW_TASK_STATUS_UNSPECIFIED;
    const compareStatus = compareTask.status ?? WorkflowTaskStatus.WORKFLOW_TASK_STATUS_UNSPECIFIED;
    const statusChanged = baseStatus !== compareStatus;

    const baseDurationMs = taskDurationMs(baseTask);
    const compareDurationMs = taskDurationMs(compareTask);
    const durationDeltaMs =
      baseDurationMs != null && compareDurationMs != null
        ? baseDurationMs - compareDurationMs
        : null;

    const baseCostMicros = BigInt(baseTask.costMicros ?? 0);
    const compareCostMicros = BigInt(compareTask.costMicros ?? 0);
    const baseTokens = BigInt(baseTask.inputTokens ?? 0) + BigInt(baseTask.outputTokens ?? 0);
    const compareTokens = BigInt(compareTask.inputTokens ?? 0) + BigInt(compareTask.outputTokens ?? 0);

    if (statusChanged && divergencePoint === null) {
      divergencePoint = name;
    }

    tasks.push({
      taskName: name,
      taskKind: taskKindLabel(baseTask),
      baseStatus,
      compareStatus,
      statusChanged,
      baseDurationMs,
      compareDurationMs,
      durationDeltaMs,
      baseCostMicros,
      compareCostMicros,
      baseTokens,
      compareTokens,
      baseError: baseTask.error || null,
      compareError: compareTask.error || null,
    });
  }

  const durationDeltaMs =
    baseRow.durationMs != null && compareRow.durationMs != null
      ? baseRow.durationMs - compareRow.durationMs
      : null;

  return {
    baseRow,
    compareRow,
    durationDeltaMs,
    costDeltaMicros: baseRow.costMicros - compareRow.costMicros,
    tokensDelta: baseRow.totalTokens - compareRow.totalTokens,
    tasks,
    tasksOnlyInBase,
    tasksOnlyInCompare,
    divergencePoint,
  };
}
