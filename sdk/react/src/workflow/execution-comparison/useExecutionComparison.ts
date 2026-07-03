"use client";

import { useMemo } from "react";
import { useWorkflowExecution } from "../useWorkflowExecution.js";
import { deriveExecutionComparison } from "./derive-execution-comparison.js";
import type { ExecutionComparison } from "./types.js";

/** Options for {@link useExecutionComparison}. */
export interface UseExecutionComparisonOptions {
  /** The "baseline" execution ID (typically the run being viewed). */
  readonly baseId: string | null;
  /** The "compare" execution ID (typically a recent successful run). */
  readonly compareId: string | null;
}

/** Return value of {@link useExecutionComparison}. */
export interface UseExecutionComparisonReturn {
  /** Derived comparison result, or `null` while loading or on error. */
  readonly comparison: ExecutionComparison | null;
  /** `true` while either execution is being fetched. */
  readonly isLoading: boolean;
  /** First error from either fetch, or `null` when healthy. */
  readonly error: Error | null;
  /** Re-fetch both executions. */
  readonly refetch: () => void;
}

/**
 * Behavior hook that fetches two workflow executions and derives
 * a structural comparison between them.
 *
 * Pass `null` for either ID to skip that fetch (e.g., while the
 * user is selecting a comparison target). The comparison result
 * is only produced when both executions are loaded.
 *
 * Returns referentially stable objects when inputs haven't changed
 * (DD-010 compliance).
 *
 * @example
 * ```tsx
 * const { comparison, isLoading } = useExecutionComparison({
 *   baseId: "wfx_failed_123",
 *   compareId: "wfx_success_456",
 * });
 * if (comparison) {
 *   console.log(comparison.divergencePoint);
 * }
 * ```
 */
export function useExecutionComparison({
  baseId,
  compareId,
}: UseExecutionComparisonOptions): UseExecutionComparisonReturn {
  const {
    execution: baseExecution,
    isLoading: baseLoading,
    error: baseError,
    refetch: baseRefetch,
  } = useWorkflowExecution(baseId);

  const {
    execution: compareExecution,
    isLoading: compareLoading,
    error: compareError,
    refetch: compareRefetch,
  } = useWorkflowExecution(compareId);

  const comparison = useMemo(() => {
    if (!baseExecution || !compareExecution) return null;
    return deriveExecutionComparison(baseExecution, compareExecution);
  }, [baseExecution, compareExecution]);

  const refetch = useMemo(
    () => () => {
      baseRefetch();
      compareRefetch();
    },
    [baseRefetch, compareRefetch],
  );

  return {
    comparison,
    isLoading: baseLoading || compareLoading,
    error: baseError ?? compareError ?? null,
    refetch,
  };
}
