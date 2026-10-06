"use client";

import { useMemo } from "react";
import { useWorkflowRunList } from "../useWorkflowRunList.js";
import {
  deriveRunRows,
  filterRunRows,
  type RunRow,
  type RunClientFilters,
} from "./derive-run-row.js";

/** Options for {@link useRunHistoryData}. */
export interface UseRunHistoryDataOptions {
  /**
   * When set, scopes the list to runs of this workflow.
   * When omitted, lists all runs across all workflows.
   */
  readonly workflowId?: string | null;
  /** Maximum runs per page. @default 20 */
  readonly pageSize?: number;
  /** Opaque cursor for paginated fetching. */
  readonly pageToken?: string;
  /**
   * Client-side filters applied post-fetch to the loaded page.
   * These are a stopgap until server-side filters are wired.
   */
  readonly clientFilters?: RunClientFilters;
}

/** Return value of {@link useRunHistoryData}. */
export interface UseRunHistoryDataReturn {
  /** Derived, optionally filtered run rows for the current page. */
  readonly rows: readonly RunRow[];
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
 * Behavior hook that composes {@link useWorkflowRunList} with the
 * {@link deriveRunRows} derivation pipeline and optional client-side
 * filters.
 *
 * Returns pre-computed {@link RunRow} objects ready for rendering
 * by {@link RunHistoryTable}.
 *
 * @example
 * ```tsx
 * const { rows, isLoading, error, refetch } = useRunHistoryData({
 *   workflowId: "wf_onboarding",
 *   pageSize: 20,
 *   clientFilters: { phases: [RunPhase.RUN_FAILED] },
 * });
 * ```
 */
export function useRunHistoryData(
  options?: UseRunHistoryDataOptions,
): UseRunHistoryDataReturn {
  const workflowId = options?.workflowId ?? null;
  const pageSize = options?.pageSize ?? 20;
  const pageToken = options?.pageToken;
  const clientFilters = options?.clientFilters;

  const {
    runs: executions,
    totalPages,
    isLoading,
    isRefetching,
    error,
    refetch,
  } = useWorkflowRunList({ workflowId, pageSize, pageToken });

  const derivedRows = useMemo(
    () => deriveRunRows(executions),
    [executions],
  );

  const filteredRows = useMemo(() => {
    if (!clientFilters || Object.keys(clientFilters).length === 0) {
      return derivedRows;
    }
    return filterRunRows(derivedRows, clientFilters);
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
