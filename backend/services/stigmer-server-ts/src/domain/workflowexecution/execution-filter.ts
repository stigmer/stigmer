/**
 * Execution list filtering and sorting — ports execution_filter.go
 * (T13 Execution History): the structured ExecutionFilterCriteria
 * matcher, the sort-field comparator, and the legacy top-level phase
 * filter. Proven by __tests__/execution-filter.test.ts (Go's 11-case
 * execution_filter_test.go ported case-for-case).
 *
 * Time parsing: Go accepts RFC3339Nano/RFC3339 and treats unparseable
 * strings as the zero time (which sorts before every real instant and
 * fails IsZero-guarded filters). This port parses to epoch milliseconds
 * with the same strictness (date+time+zone required) and mirrors zero
 * time as NaN. Precision note: Go compares at nanosecond precision, JS
 * Date at millisecond — sub-millisecond duration-filter boundaries are
 * the only divergence, below anything the system writes or the suites
 * assert.
 */
import type { Duration } from "@bufbuild/protobuf/wkt";
import { timestampMs } from "@bufbuild/protobuf/wkt";

import type {
  WorkflowExecution,
  WorkflowTask,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import {
  ExecutionPhase,
  WorkflowTaskStatus,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import { ExecutionSortField } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/io_pb";
import type { ExecutionFilterCriteria } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/io_pb";

/**
 * Strict RFC3339 shape gate: Go time.Parse(RFC3339Nano/RFC3339) requires
 * the T separator and an explicit zone; JS Date.parse is looser (it
 * accepts date-only strings, for one), so unguarded parsing would accept
 * strings Go maps to the zero time.
 */
const RFC3339_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * Go's parseTime: RFC3339(Nano) → instant; anything else → the zero time,
 * mirrored here as NaN (callers guard with Number.isNaN exactly where Go
 * guards with IsZero).
 */
export function parseRfc3339Ms(iso: string): number {
  if (iso === "" || !RFC3339_PATTERN.test(iso)) {
    return Number.NaN;
  }
  return Date.parse(iso);
}

/**
 * applyFilterCriteria — returns only entries matching every specified
 * condition (AND logic); a nil filter passes everything through.
 */
export function applyFilterCriteria(
  executions: WorkflowExecution[],
  filter: ExecutionFilterCriteria | undefined,
): WorkflowExecution[] {
  if (filter === undefined) {
    return executions;
  }
  return executions.filter((execution) => matchesFilter(execution, filter));
}

function matchesFilter(
  execution: WorkflowExecution,
  f: ExecutionFilterCriteria,
): boolean {
  const status = execution.status;

  if (f.phases.length > 0) {
    const phase = status?.phase ?? ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED;
    if (!f.phases.includes(phase)) {
      return false;
    }
  }

  if (f.startedAfter !== undefined) {
    const started = parseRfc3339Ms(status?.startedAt ?? "");
    if (Number.isNaN(started) || started < timestampMs(f.startedAfter)) {
      return false;
    }
  }

  if (f.startedBefore !== undefined) {
    const started = parseRfc3339Ms(status?.startedAt ?? "");
    if (Number.isNaN(started) || started > timestampMs(f.startedBefore)) {
      return false;
    }
  }

  if (f.minDuration !== undefined || f.maxDuration !== undefined) {
    const started = parseRfc3339Ms(status?.startedAt ?? "");
    const completed = parseRfc3339Ms(status?.completedAt ?? "");
    if (Number.isNaN(started) || Number.isNaN(completed)) {
      return false;
    }
    const durationMs = completed - started;
    if (
      f.minDuration !== undefined &&
      durationMs < durationToMs(f.minDuration)
    ) {
      return false;
    }
    if (
      f.maxDuration !== undefined &&
      durationMs > durationToMs(f.maxDuration)
    ) {
      return false;
    }
  }

  const costMicros = status?.totalCostMicros ?? 0n;
  if (f.minCostMicros > 0n && costMicros < f.minCostMicros) {
    return false;
  }
  if (f.maxCostMicros > 0n && costMicros > f.maxCostMicros) {
    return false;
  }

  if (f.failedTaskName !== "") {
    const found = (status?.tasks ?? []).some(
      (task) =>
        task.status === WorkflowTaskStatus.WORKFLOW_TASK_FAILED &&
        task.taskName === f.failedTaskName,
    );
    if (!found) {
      return false;
    }
  }

  if (f.hasRetries) {
    const hasRetry = (status?.tasks ?? []).some(
      (task) => extractRetryCountFromMetadata(task) > 0,
    );
    if (!hasRetry) {
      return false;
    }
  }

  return true;
}

/**
 * A task counts as retried when its metadata carries retry_count > 0
 * (either snake_case or camelCase key — Go checks both).
 */
export function extractRetryCountFromMetadata(task: WorkflowTask): number {
  const fields = task.metadata;
  if (fields === undefined) {
    return 0;
  }
  const retryField = fields["retry_count"] ?? fields["retryCount"];
  if (typeof retryField !== "number" || retryField <= 0) {
    return 0;
  }
  return Math.trunc(retryField);
}

function durationToMs(duration: Duration): number {
  return Number(duration.seconds) * 1000 + duration.nanos / 1e6;
}

/**
 * applySortField — stable in-place sort by the requested field (Go
 * sort.SliceStable; Array.prototype.sort is spec-stable). Descending is
 * Go's `!less(a,b) && less(b,a)` — strictly-greater-first, ties keeping
 * scan order.
 */
export function applySortField(
  executions: WorkflowExecution[],
  sortField: ExecutionSortField,
  ascending: boolean,
): void {
  if (executions.length <= 1) {
    return;
  }
  executions.sort((a, b) => {
    if (lessBySortField(a, b, sortField)) {
      return ascending ? -1 : 1;
    }
    if (lessBySortField(b, a, sortField)) {
      return ascending ? 1 : -1;
    }
    return 0;
  });
}

function lessBySortField(
  a: WorkflowExecution,
  b: WorkflowExecution,
  field: ExecutionSortField,
): boolean {
  switch (field) {
    case ExecutionSortField.DURATION:
      return executionDurationMs(a) < executionDurationMs(b);
    case ExecutionSortField.COST:
      return (
        (a.status?.totalCostMicros ?? 0n) < (b.status?.totalCostMicros ?? 0n)
      );
    case ExecutionSortField.STATUS:
      return (
        (a.status?.phase ?? ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED) <
        (b.status?.phase ?? ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED)
      );
    case ExecutionSortField.UNSPECIFIED:
    case ExecutionSortField.STARTED_AT: {
      // Go's zero time (unparseable/empty started_at) sorts before every
      // real instant; NaN maps to -Infinity to preserve that ordering.
      const ta = orNegativeInfinity(parseRfc3339Ms(a.status?.startedAt ?? ""));
      const tb = orNegativeInfinity(parseRfc3339Ms(b.status?.startedAt ?? ""));
      return ta < tb;
    }
    default: {
      const exhaustive: never = field;
      throw new Error(`unhandled sort field: ${String(exhaustive)}`);
    }
  }
}

/**
 * Go's executionDurationMs: -1 when either timestamp is missing, so all
 * incomplete executions tie below every real duration.
 */
export function executionDurationMs(execution: WorkflowExecution): number {
  const started = parseRfc3339Ms(execution.status?.startedAt ?? "");
  const completed = parseRfc3339Ms(execution.status?.completedAt ?? "");
  if (Number.isNaN(started) || Number.isNaN(completed)) {
    return -1;
  }
  return completed - started;
}

function orNegativeInfinity(value: number): number {
  return Number.isNaN(value) ? Number.NEGATIVE_INFINITY : value;
}

/**
 * applyLegacyPhaseFilter — the deprecated top-level `phase` request field,
 * applied only when filter.phases is absent (list.go's fallback).
 */
export function applyLegacyPhaseFilter(
  executions: WorkflowExecution[],
  phase: ExecutionPhase,
): WorkflowExecution[] {
  if (phase === ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED) {
    return executions;
  }
  return executions.filter(
    (execution) =>
      (execution.status?.phase ??
        ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED) === phase,
  );
}
