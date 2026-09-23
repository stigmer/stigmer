"use client";

import type { WorkflowExecution } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { create } from "@bufbuild/protobuf";
import {
  ListWorkflowExecutionsRequestSchema,
  ListWorkflowExecutionsByWorkflowRequestSchema,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/io_pb";
import { useMemo } from "react";
import { useStigmer } from "../hooks.js";
import { useCursorPages } from "../internal/useCursorPages.js";

/**
 * Client-side execution filter criteria.
 *
 * Placeholder until backend proto adds `ExecutionFilterCriteria`.
 */
export interface ExecutionFilterCriteria {
  readonly phases?: readonly number[];
  readonly workflowId?: string;
}

/**
 * Client-side execution sort field.
 *
 * Placeholder re-export matching the local type in execution-history.
 */
export type ExecutionSortField = "startTime" | "endTime" | "duration" | "status" | "cost" | "tokens";

/** Options for {@link useWorkflowExecutionList}. */
export interface UseWorkflowExecutionListOptions {
  /** Executions per page, the first and each `loadMore`; the server caps it at 100. @default 20 */
  readonly pageSize?: number;
  /** Opaque page token the first page starts from; `loadMore` continues after it. */
  readonly pageToken?: string;
  /**
   * Workflow or WorkflowInstance ID to scope executions.
   * When omitted, lists all executions across all workflows.
   */
  readonly workflowId?: string | null;
  /**
   * Organization slug to scope the cross-workflow listing to. Applies only
   * to the `list()` branch (no `workflowId`); ignored by `listByWorkflow()`,
   * which is already scoped by the workflow itself.
   *
   * When omitted, results are bounded only by the caller's view permissions —
   * for a member of several organizations that spans all of them. Console
   * pages should always pass the active org.
   */
  readonly org?: string | null;
  /**
   * Server-side filter criteria. When set, the backend filters
   * before returning results, reducing transfer size.
   *
   * @since T13 (Execution History)
   */
  readonly filter?: Partial<ExecutionFilterCriteria>;
  /**
   * Server-side sort field.
   *
   * @since T13 (Execution History)
   */
  readonly sortField?: ExecutionSortField;
  /**
   * When true, sorts ascending. Defaults to false (descending).
   *
   * @since T13 (Execution History)
   */
  readonly sortAscending?: boolean;
}

/** Return value of {@link useWorkflowExecutionList}. */
export interface UseWorkflowExecutionListReturn {
  /** Executions newest created first: the first page, then every page loaded since. */
  readonly executions: readonly WorkflowExecution[];
  /**
   * The first page's `total_pages`: 1 when it holds the whole list, 0 while
   * more pages follow. The server does not count pages; read `hasMore`.
   */
  readonly totalPages: number;
  /** `true` while more executions exist beyond what is loaded. */
  readonly hasMore: boolean;
  /** Load the next page of older executions. No-op while one is loading. */
  readonly loadMore: () => void;
  /** `true` while a `loadMore` page is in flight. */
  readonly isLoadingMore: boolean;
  /** Error from the last failed `loadMore`, or `null`. Cleared on retry. */
  readonly loadMoreError: Error | null;
  /** `true` while the initial fetch is in flight. */
  readonly isLoading: boolean;
  /** `true` while a background refetch is in flight and stale data is shown. */
  readonly isRefetching: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Re-fetch the first page; loaded older pages stay. */
  readonly refetch: () => void;
}

interface ExecutionPage {
  readonly entries: readonly WorkflowExecution[];
  readonly nextPageToken: string;
  readonly totalPages: number;
}

function executionIdentity(execution: WorkflowExecution): string {
  return execution.metadata?.id ?? "";
}

/**
 * Data hook that lists workflow executions newest created first, one page
 * at a time.
 *
 * When `workflowId` is provided, lists that workflow's executions via
 * `listByWorkflow()`; otherwise every execution via `list()`, scoped by
 * `org` when given. The first page loads on mount; `loadMore()` appends
 * the next while `hasMore` is true.
 *
 * @example
 * ```tsx
 * // One organization's executions, with "Show more"
 * const { executions, hasMore, loadMore, isLoadingMore } =
 *   useWorkflowExecutionList({ org, pageSize: 50 });
 *
 * // Executions for a specific workflow
 * const { executions } = useWorkflowExecutionList({
 *   workflowId: workflow.metadata?.id,
 *   pageSize: 10,
 * });
 * ```
 */
export function useWorkflowExecutionList(
  options?: UseWorkflowExecutionListOptions,
): UseWorkflowExecutionListReturn {
  const stigmer = useStigmer();
  const pageSize = options?.pageSize ?? 20;
  const startToken = options?.pageToken ?? "";
  const workflowId = options?.workflowId ?? null;
  const org = options?.org ?? "";

  const fetchPage = async (token: string): Promise<ExecutionPage> => {
    const pageToken = token === "" ? startToken : token;
    const resp = workflowId
      ? await stigmer.workflowExecution.listByWorkflow(
          create(ListWorkflowExecutionsByWorkflowRequestSchema, { workflowId, pageSize, pageToken }),
        )
      : await stigmer.workflowExecution.list(
          create(ListWorkflowExecutionsRequestSchema, { pageSize, pageToken, org }),
        );
    return {
      entries: resp.entries,
      nextPageToken: resp.nextPageToken,
      totalPages: resp.totalPages,
    };
  };

  const {
    items,
    firstPage,
    hasMore,
    loadMore,
    isLoadingMore,
    loadMoreError,
    isLoading,
    isRefetching,
    error,
    refetch,
  } = useCursorPages<WorkflowExecution, ExecutionPage>(
    fetchPage,
    [stigmer, workflowId, org, pageSize, startToken],
    executionIdentity,
  );
  const totalPages = firstPage?.totalPages ?? 0;

  return useMemo(
    () => ({
      executions: items,
      totalPages,
      hasMore,
      loadMore,
      isLoadingMore,
      loadMoreError,
      isLoading,
      isRefetching,
      error,
      refetch,
    }),
    [items, totalPages, hasMore, loadMore, isLoadingMore, loadMoreError, isLoading, isRefetching, error, refetch],
  );
}
