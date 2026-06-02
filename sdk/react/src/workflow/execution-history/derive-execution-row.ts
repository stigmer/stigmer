import type { WorkflowExecution } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import {
  ExecutionPhase,
  WorkflowTaskStatus,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";

/**
 * A flattened, UI-ready row derived from a {@link WorkflowExecution}.
 *
 * All computed fields (duration, failed task, retry count) are derived
 * from the execution's status data — no additional API calls needed.
 * This type is the contract between the derivation layer and the table
 * component; it intentionally avoids protobuf types so the table can
 * be tested and rendered without proto dependencies.
 */
export interface ExecutionRow {
  readonly id: string;
  readonly name: string;
  readonly phase: ExecutionPhase;
  readonly startedAt: Date | null;
  readonly completedAt: Date | null;
  /** Milliseconds between started_at and completed_at. `null` when not yet completed or timestamps missing. */
  readonly durationMs: number | null;
  readonly costMicros: bigint;
  readonly inputTokens: bigint;
  readonly outputTokens: bigint;
  readonly totalTokens: bigint;
  readonly taskCount: number;
  readonly completedTaskCount: number;
  /** Name of the first task in FAILED status, or `null` if none. */
  readonly failedTaskName: string | null;
  /** Name of the first task in IN_PROGRESS status, or `null` if none. */
  readonly currentTaskName: string | null;
  /** Number of retry attempts across all tasks (derived from task metadata). */
  readonly retryCount: number;
  /** `true` when any task is in WAITING_APPROVAL status. */
  readonly hasHumanWait: boolean;
  readonly error: string | null;
  /** Reference to the original execution for downstream consumers that need the full object. */
  readonly _source: WorkflowExecution;
}

const BIGINT_ZERO = BigInt(0);

const TERMINAL_TASK_STATUSES = new Set([
  WorkflowTaskStatus.WORKFLOW_TASK_COMPLETED,
  WorkflowTaskStatus.WORKFLOW_TASK_FAILED,
  WorkflowTaskStatus.WORKFLOW_TASK_SKIPPED,
]);

function parseIsoDate(iso: string | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function extractRetryCount(metadata: { fields?: Record<string, unknown> } | undefined): number {
  if (!metadata?.fields) return 0;
  const retryField = metadata.fields["retry_count"] ?? metadata.fields["retryCount"];
  if (retryField && typeof retryField === "object" && retryField !== null && "numberValue" in retryField) {
    return Math.max(0, Math.floor((retryField as { numberValue: number }).numberValue ?? 0));
  }
  return 0;
}

/**
 * Derives a UI-ready {@link ExecutionRow} from a raw {@link WorkflowExecution}.
 *
 * Pure function with zero side effects. Computes duration, identifies
 * the failed/current task, counts retries, and normalizes bigint fields.
 */
export function deriveExecutionRow(exec: WorkflowExecution): ExecutionRow {
  const meta = exec.metadata;
  const status = exec.status;
  const tasks = status?.tasks ?? [];

  const startedAt = parseIsoDate(status?.startedAt);
  const completedAt = parseIsoDate(status?.completedAt);

  let durationMs: number | null = null;
  if (startedAt && completedAt) {
    durationMs = completedAt.getTime() - startedAt.getTime();
  } else if (startedAt && status?.phase === ExecutionPhase.EXECUTION_IN_PROGRESS) {
    durationMs = Date.now() - startedAt.getTime();
  }

  let failedTaskName: string | null = null;
  let currentTaskName: string | null = null;
  let completedTaskCount = 0;
  let retryCount = 0;
  let hasHumanWait = false;

  for (const task of tasks) {
    if (TERMINAL_TASK_STATUSES.has(task.status)) {
      completedTaskCount++;
    }
    if (!failedTaskName && task.status === WorkflowTaskStatus.WORKFLOW_TASK_FAILED) {
      failedTaskName = task.taskName || null;
    }
    if (!currentTaskName && task.status === WorkflowTaskStatus.WORKFLOW_TASK_IN_PROGRESS) {
      currentTaskName = task.taskName || null;
    }
    if (task.status === WorkflowTaskStatus.WORKFLOW_TASK_WAITING_APPROVAL) {
      hasHumanWait = true;
      if (!currentTaskName) currentTaskName = task.taskName || null;
    }
    retryCount += extractRetryCount(task.metadata);
  }

  const costMicros = BigInt(status?.totalCostMicros ?? 0);
  const inputTokens = BigInt(status?.totalInputTokens ?? 0);
  const outputTokens = BigInt(status?.totalOutputTokens ?? 0);

  return {
    id: meta?.id ?? "",
    name: meta?.name || meta?.slug || "",
    phase: status?.phase ?? ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED,
    startedAt,
    completedAt,
    durationMs,
    costMicros,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    taskCount: tasks.length,
    completedTaskCount,
    failedTaskName,
    currentTaskName,
    retryCount,
    hasHumanWait,
    error: status?.error || null,
    _source: exec,
  };
}

/**
 * Batch-derives execution rows from a list of raw executions.
 * Preserves input order.
 */
export function deriveExecutionRows(executions: readonly WorkflowExecution[]): ExecutionRow[] {
  return executions.map(deriveExecutionRow);
}

// ---------------------------------------------------------------------------
// Client-side sorting
// ---------------------------------------------------------------------------

export type ExecutionSortField =
  | "name"
  | "phase"
  | "startedAt"
  | "duration"
  | "cost"
  | "tokens"
  | "tasks";

export type SortDirection = "asc" | "desc";

type CompareFn = (a: ExecutionRow, b: ExecutionRow) => number;

const SORT_COMPARATORS: Record<ExecutionSortField, CompareFn> = {
  name: (a, b) => a.name.localeCompare(b.name),
  phase: (a, b) => a.phase - b.phase,
  startedAt: (a, b) => (a.startedAt?.getTime() ?? 0) - (b.startedAt?.getTime() ?? 0),
  duration: (a, b) => (a.durationMs ?? -1) - (b.durationMs ?? -1),
  cost: (a, b) => Number(a.costMicros - b.costMicros),
  tokens: (a, b) => Number(a.totalTokens - b.totalTokens),
  tasks: (a, b) => a.taskCount - b.taskCount,
};

/**
 * Sorts execution rows by a given field and direction.
 * Returns a new array (does not mutate the input).
 */
export function sortExecutionRows(
  rows: readonly ExecutionRow[],
  field: ExecutionSortField,
  direction: SortDirection,
): ExecutionRow[] {
  const cmp = SORT_COMPARATORS[field];
  const multiplier = direction === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => multiplier * cmp(a, b));
}

// ---------------------------------------------------------------------------
// Client-side filtering
// ---------------------------------------------------------------------------

export interface ExecutionClientFilters {
  readonly phases?: readonly ExecutionPhase[];
  readonly minDurationMs?: number;
  readonly maxDurationMs?: number;
  readonly minCostMicros?: bigint;
  readonly maxCostMicros?: bigint;
  readonly failedTaskName?: string;
  readonly hasRetries?: boolean;
}

/**
 * Applies client-side filters to execution rows.
 * Returns a new array containing only rows that match all criteria.
 */
export function filterExecutionRows(
  rows: readonly ExecutionRow[],
  filters: ExecutionClientFilters,
): ExecutionRow[] {
  return rows.filter((row) => {
    if (filters.phases?.length && !filters.phases.includes(row.phase)) {
      return false;
    }
    if (filters.minDurationMs != null && (row.durationMs ?? -1) < filters.minDurationMs) {
      return false;
    }
    if (filters.maxDurationMs != null && (row.durationMs ?? Infinity) > filters.maxDurationMs) {
      return false;
    }
    if (filters.minCostMicros != null && row.costMicros < filters.minCostMicros) {
      return false;
    }
    if (filters.maxCostMicros != null && row.costMicros > filters.maxCostMicros) {
      return false;
    }
    if (filters.failedTaskName && row.failedTaskName !== filters.failedTaskName) {
      return false;
    }
    if (filters.hasRetries && row.retryCount === 0) {
      return false;
    }
    return true;
  });
}
