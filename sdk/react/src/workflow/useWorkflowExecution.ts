"use client";

import type { WorkflowExecution } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { isNotFound } from "@stigmer/sdk";
import { useStigmer } from "../hooks";
import { useFetch } from "../internal/useFetch";

/** Return value of {@link useWorkflowExecution}. */
export interface UseWorkflowExecutionReturn {
  /** The resolved execution, or `null` while loading, on error, or when not found. */
  readonly execution: WorkflowExecution | null;
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
 * Data hook that fetches a single WorkflowExecution by ID.
 *
 * Pass `null` for `executionId` to skip fetching (stable no-op).
 * When the ID changes, the previous request is discarded and a
 * fresh fetch begins.
 *
 * If the API returns NOT_FOUND, `execution` is set to `null`
 * without raising an error.
 *
 * @example
 * ```tsx
 * function ExecutionHeader({ id }: { id: string }) {
 *   const { execution, isLoading, error } = useWorkflowExecution(id);
 *   if (isLoading) return <Skeleton />;
 *   if (error) return <ErrorMessage error={error} />;
 *   if (!execution) return <NotFound />;
 *   return <h2>{execution.metadata?.name}</h2>;
 * }
 * ```
 */
export function useWorkflowExecution(
  executionId: string | null,
): UseWorkflowExecutionReturn {
  const stigmer = useStigmer();

  const fetchFn = executionId
    ? async () => {
        try {
          return await stigmer.workflowExecution.get(executionId);
        } catch (err) {
          if (isNotFound(err)) return null;
          throw err;
        }
      }
    : null;

  const { data: execution, isLoading, isRefetching, error, refetch } = useFetch(
    fetchFn,
    [executionId, stigmer],
    null,
    { cacheKey: executionId ? `workflow-execution:${executionId}` : undefined },
  );

  return { execution, isLoading, isRefetching, error, refetch };
}
