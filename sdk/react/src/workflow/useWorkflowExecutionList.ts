"use client";

import type { WorkflowExecution } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { create } from "@bufbuild/protobuf";
import {
  ListWorkflowExecutionsRequestSchema,
  ListWorkflowExecutionsByWorkflowRequestSchema,
  ExecutionFilterCriteriaSchema,
  type ExecutionFilterCriteria,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/io_pb";
import { ExecutionSortField } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/io_pb";
import { useStigmer } from "../hooks";
import { useFetch } from "../internal/useFetch";

export type { ExecutionFilterCriteria };
export { ExecutionSortField };

/** Options for {@link useWorkflowExecutionList}. */
export interface UseWorkflowExecutionListOptions {
  /** Maximum executions per page. @default 20 */
  readonly pageSize?: number;
  /** Opaque page token for cursor-based pagination. */
  readonly pageToken?: string;
  /**
   * Workflow or WorkflowInstance ID to scope executions.
   * When omitted, lists all executions across all workflows.
   */
  readonly workflowId?: string | null;
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
  /** Execution entries for the current page. */
  readonly executions: readonly WorkflowExecution[];
  /** Total pages available at the current page size. */
  readonly totalPages: number;
  /** `true` while the initial fetch or a refetch is in flight. */
  readonly isLoading: boolean;
  /** `true` while a background refetch is in flight and stale data is shown. */
  readonly isRefetching: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch from the server. */
  readonly refetch: () => void;
}

interface ExecutionListData {
  executions: readonly WorkflowExecution[];
  totalPages: number;
}

const INITIAL_DATA: ExecutionListData = {
  executions: [],
  totalPages: 0,
};

/**
 * Data hook that fetches a paginated list of workflow executions.
 *
 * When `workflowId` is provided, fetches executions for that specific
 * workflow via `listByWorkflow()`. When omitted, fetches all executions
 * across all workflows via `list()`.
 *
 * @example
 * ```tsx
 * // All executions
 * const { executions, isLoading } = useWorkflowExecutionList();
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
  const pageToken = options?.pageToken ?? "";
  const workflowId = options?.workflowId ?? null;
  const filter = options?.filter;
  const sortField = options?.sortField;
  const sortAscending = options?.sortAscending ?? false;

  const filterProto = filter
    ? create(ExecutionFilterCriteriaSchema, filter as Record<string, unknown>)
    : undefined;

  const fetchFn = async () => {
    if (workflowId) {
      const req: Record<string, unknown> = { workflowId, pageSize, pageToken };
      if (filterProto) req.filter = filterProto;
      if (sortField != null) req.sortField = sortField;
      if (sortAscending) req.sortAscending = true;

      const resp = await stigmer.workflowExecution.listByWorkflow(
        create(ListWorkflowExecutionsByWorkflowRequestSchema, req),
      );
      return {
        executions: [...resp.entries],
        totalPages: resp.totalPages,
      };
    }

    const req: Record<string, unknown> = { pageSize, pageToken };
    if (filterProto) req.filter = filterProto;
    if (sortField != null) req.sortField = sortField;
    if (sortAscending) req.sortAscending = true;

    const resp = await stigmer.workflowExecution.list(
      create(ListWorkflowExecutionsRequestSchema, req),
    );
    return {
      executions: [...resp.entries],
      totalPages: resp.totalPages,
    };
  };

  const {
    data,
    isLoading,
    isRefetching,
    error,
    refetch,
  } = useFetch<ExecutionListData>(
    fetchFn,
    [stigmer, workflowId, pageSize, pageToken, filter, sortField, sortAscending],
    INITIAL_DATA,
  );

  return {
    executions: data.executions,
    totalPages: data.totalPages,
    isLoading,
    isRefetching,
    error,
    refetch,
  };
}
