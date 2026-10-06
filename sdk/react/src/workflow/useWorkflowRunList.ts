"use client";

import type { WorkflowRun } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/api_pb";
import { create } from "@bufbuild/protobuf";
import {
  ListWorkflowRunsRequestSchema,
  ListWorkflowRunsByWorkflowRequestSchema,
} from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/io_pb";
import { useMemo } from "react";
import { useStigmer } from "../hooks.js";
import { useCursorPages } from "../internal/useCursorPages.js";

/**
 * Client-side run filter criteria.
 *
 * Placeholder until backend proto adds `RunFilterCriteria`.
 */
export interface RunFilterCriteria {
  readonly phases?: readonly number[];
  readonly workflowId?: string;
}

/**
 * Client-side run sort field.
 *
 * Placeholder re-export matching the local type in execution-history.
 */
export type RunSortField = "startTime" | "endTime" | "duration" | "status" | "cost" | "tokens";

/** Options for {@link useWorkflowRunList}. */
export interface UseWorkflowRunListOptions {
  /** Runs per page, the first and each `loadMore`; the server caps it at 100. @default 20 */
  readonly pageSize?: number;
  /** Opaque page token the first page starts from; `loadMore` continues after it. */
  readonly pageToken?: string;
  /**
   * Workflow ID to scope runs.
   * When omitted, lists all runs across all workflows.
   */
  readonly workflowId?: string | null;
  /**
   * Organization id to scope the cross-workflow listing to (a slug is also accepted). Applies only
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
   */
  readonly filter?: Partial<RunFilterCriteria>;
  /**
   * Server-side sort field.
   */
  readonly sortField?: RunSortField;
  /**
   * When true, sorts ascending. Defaults to false (descending).
   */
  readonly sortAscending?: boolean;
}

/** Return value of {@link useWorkflowRunList}. */
export interface UseWorkflowRunListReturn {
  /** Runs newest created first: the first page, then every page loaded since. */
  readonly runs: readonly WorkflowRun[];
  /**
   * The first page's `total_pages`: 1 when it holds the whole list, 0 while
   * more pages follow. The server does not count pages; read `hasMore`.
   */
  readonly totalPages: number;
  /** `true` while more runs exist beyond what is loaded. */
  readonly hasMore: boolean;
  /** Load the next page of older runs. No-op while one is loading. */
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
  readonly entries: readonly WorkflowRun[];
  readonly nextPageToken: string;
  readonly totalPages: number;
}

function executionIdentity(execution: WorkflowRun): string {
  return execution.metadata?.id ?? "";
}

/**
 * Data hook that lists workflow runs newest created first, one page
 * at a time.
 *
 * When `workflowId` is provided, lists that workflow's runs via
 * `listByWorkflow()`; otherwise every run via `list()`, scoped by
 * `org` when given. The first page loads on mount; `loadMore()` appends
 * the next while `hasMore` is true.
 *
 * @example
 * ```tsx
 * // One organization's runs, with "Show more"
 * const { runs, hasMore, loadMore, isLoadingMore } =
 *   useWorkflowRunList({ org, pageSize: 50 });
 *
 * // Runs for a specific workflow
 * const { runs } = useWorkflowRunList({
 *   workflowId: workflow.metadata?.id,
 *   pageSize: 10,
 * });
 * ```
 */
export function useWorkflowRunList(
  options?: UseWorkflowRunListOptions,
): UseWorkflowRunListReturn {
  const stigmer = useStigmer();
  const pageSize = options?.pageSize ?? 20;
  const startToken = options?.pageToken ?? "";
  const workflowId = options?.workflowId ?? null;
  const org = options?.org ?? "";

  const fetchPage = async (token: string): Promise<ExecutionPage> => {
    const pageToken = token === "" ? startToken : token;
    const resp = workflowId
      ? await stigmer.workflowRun.listByWorkflow(
          create(ListWorkflowRunsByWorkflowRequestSchema, { workflowId, pageSize, pageToken }),
        )
      : await stigmer.workflowRun.list(
          create(ListWorkflowRunsRequestSchema, { pageSize, pageToken, org }),
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
  } = useCursorPages<WorkflowRun, ExecutionPage>(
    fetchPage,
    [stigmer, workflowId, org, pageSize, startToken],
    executionIdentity,
  );
  const totalPages = firstPage?.totalPages ?? 0;

  return useMemo(
    () => ({
      runs: items,
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
