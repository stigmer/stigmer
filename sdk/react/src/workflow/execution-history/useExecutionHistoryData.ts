"use client";

import { useMemo } from "react";
import { useWorkflowExecutionList } from "../useWorkflowExecutionList.js";
import {
  deriveExecutionRows,
  filterExecutionRows,
  type ExecutionRow,
  type ExecutionClientFilters,
} from "./derive-execution-row.js";

/** Options for {@link useExecutionHistoryData}. */
export interface UseExecutionHistoryDataOptions {
  /**
   * When set, scopes the list to executions of this workflow.
   * When omitted, lists all executions across all workflows.
   */
  readonly workflowId?: string | null;
  /** Maximum executions per page. @default 20 */
  readonly pageSize?: number;
  /** Opaque cursor for paginated fetching. */
  readonly pageToken?: string;
  /**
   * Client-side filters applied post-fetch to the loaded page.
   * These are a stopgap until server-side filters are wired (Phase 2).
   */
  readonly clientFilters?: ExecutionClientFilters;
}

/** Return value of {@link useExecutionHistoryData}. */
export interface UseExecutionHistoryDataReturn {
  /** Derived, optionally filtered execution rows for the current page. */
  readonly rows: readonly ExecutionRow[];
  /** Total pages from the server (does not account for client-side filtering). */
  readonly totalPages: number;
  /** `true` while the initial fetch is in flight. */
  readonly isLoading: boolean;
  /** `true` while a background refetch is in flight and stale data is shown. */
  readonly isRefetching: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch from the server. */
  readonly refetch: () => void;
}

/**
 * Behavior hook that composes {@link useWorkflowExecutionList} with the
 * {@link deriveExecutionRows} derivation pipeline and optional client-side
 * filters.
 *
 * Returns pre-computed {@link ExecutionRow} objects ready for rendering
 * by {@link ExecutionHistoryTable}.
 *
 * @example
 * ```tsx
 * const { rows, isLoading, error, refetch } = useExecutionHistoryData({
 *   workflowId: "wf_onboarding",
 *   pageSize: 20,
 *   clientFilters: { phases: [ExecutionPhase.EXECUTION_FAILED] },
 * });
 * ```
 */
export function useExecutionHistoryData(
  options?: UseExecutionHistoryDataOptions,
): UseExecutionHistoryDataReturn {
  const workflowId = options?.workflowId ?? null;
  const pageSize = options?.pageSize ?? 20;
  const pageToken = options?.pageToken;
  const clientFilters = options?.clientFilters;

  const {
    executions,
    totalPages,
    isLoading,
    isRefetching,
    error,
    refetch,
  } = useWorkflowExecutionList({ workflowId, pageSize, pageToken });

  const derivedRows = useMemo(
    () => deriveExecutionRows(executions),
    [executions],
  );

  const filteredRows = useMemo(() => {
    if (!clientFilters || Object.keys(clientFilters).length === 0) {
      return derivedRows;
    }
    return filterExecutionRows(derivedRows, clientFilters);
  }, [derivedRows, clientFilters]);

  return useMemo(
    () => ({
      rows: filteredRows,
      totalPages,
      isLoading,
      isRefetching,
      error,
      refetch,
    }),
    [filteredRows, totalPages, isLoading, isRefetching, error, refetch],
  );
}
