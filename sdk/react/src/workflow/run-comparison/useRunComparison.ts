"use client";

import { useMemo } from "react";
import { useWorkflowRun } from "../useWorkflowRun.js";
import { deriveRunComparison } from "./derive-run-comparison.js";
import type { RunComparison } from "./types.js";

/** Options for {@link useRunComparison}. */
export interface UseRunComparisonOptions {
  /** The "baseline" run ID (typically the run being viewed). */
  readonly baseId: string | null;
  /** The "compare" run ID (typically a recent successful run). */
  readonly compareId: string | null;
}

/** Return value of {@link useRunComparison}. */
export interface UseRunComparisonReturn {
  /** Derived comparison result, or `null` while loading or on error. */
  readonly comparison: RunComparison | null;
  /** `true` while either run is being fetched. */
  readonly isLoading: boolean;
  /** First error from either fetch, or `null` when healthy. */
  readonly error: Error | null;
  /** Re-fetch both runs. */
  readonly refetch: () => void;
}

/**
 * Behavior hook that fetches two workflow runs and derives
 * a structural comparison between them.
 *
 * Pass `null` for either ID to skip that fetch (e.g., while the
 * user is selecting a comparison target). The comparison result
 * is only produced when both runs are loaded.
 *
 * Returns referentially stable objects when inputs haven't changed.
 *
 * @example
 * ```tsx
 * const { comparison, isLoading } = useRunComparison({
 *   baseId: "wfx_failed_123",
 *   compareId: "wfx_success_456",
 * });
 * if (comparison) {
 *   console.log(comparison.divergencePoint);
 * }
 * ```
 */
export function useRunComparison({
  baseId,
  compareId,
}: UseRunComparisonOptions): UseRunComparisonReturn {
  const {
    run: baseExecution,
    isLoading: baseLoading,
    error: baseError,
    refetch: baseRefetch,
  } = useWorkflowRun(baseId);

  const {
    run: compareExecution,
    isLoading: compareLoading,
    error: compareError,
    refetch: compareRefetch,
  } = useWorkflowRun(compareId);

  const comparison = useMemo(() => {
    if (!baseExecution || !compareExecution) return null;
    return deriveRunComparison(baseExecution, compareExecution);
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
