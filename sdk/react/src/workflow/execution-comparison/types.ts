import type { WorkflowTaskStatus } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import type { ExecutionRow } from "../execution-history/derive-execution-row.js";

/**
 * Per-task comparison entry aligning the same task across two executions.
 *
 * Tasks are matched by `taskName` (stable across runs of the same workflow
 * version). When the workflow definition changed between runs, unmatched
 * tasks appear in {@link ExecutionComparison.tasksOnlyInBase} or
 * {@link ExecutionComparison.tasksOnlyInCompare}.
 */
export interface TaskComparison {
  readonly taskName: string;
  readonly taskKind: string;
  readonly baseStatus: WorkflowTaskStatus;
  readonly compareStatus: WorkflowTaskStatus;
  readonly statusChanged: boolean;
  readonly baseDurationMs: number | null;
  readonly compareDurationMs: number | null;
  /** Positive = base was slower, negative = compare was slower. */
  readonly durationDeltaMs: number | null;
  readonly baseCostMicros: bigint;
  readonly compareCostMicros: bigint;
  readonly baseTokens: bigint;
  readonly compareTokens: bigint;
  readonly baseError: string | null;
  readonly compareError: string | null;
}

/**
 * Complete comparison result between two workflow executions.
 *
 * Produced by {@link deriveExecutionComparison} — a pure function with
 * zero side effects that aligns tasks by name and computes deltas for
 * all numeric dimensions.
 */
export interface ExecutionComparison {
  readonly baseRow: ExecutionRow;
  readonly compareRow: ExecutionRow;
  /** Positive = base was slower. `null` when either duration is unavailable. */
  readonly durationDeltaMs: number | null;
  /** Positive = base cost more. */
  readonly costDeltaMicros: bigint;
  /** Positive = base used more tokens. */
  readonly tokensDelta: bigint;
  /** Per-task aligned comparison entries (matched by task_name). */
  readonly tasks: readonly TaskComparison[];
  /** Task names present in base but absent in compare (workflow version drift). */
  readonly tasksOnlyInBase: readonly string[];
  /** Task names present in compare but absent in base (workflow version drift). */
  readonly tasksOnlyInCompare: readonly string[];
  /**
   * Name of the first task (in execution order) where status diverges
   * between the two runs. `null` when all matched tasks have identical statuses.
   */
  readonly divergencePoint: string | null;
}
