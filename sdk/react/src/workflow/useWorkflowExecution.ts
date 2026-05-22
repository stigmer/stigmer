"use client";

import { useEffect, useRef } from "react";
import type { WorkflowExecution } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import { isNotFound } from "@stigmer/sdk";
import { useStigmer } from "../hooks";
import { useFetch } from "../internal/useFetch";
import { useRunnerAdapter } from "../runner-adapter";
import { useExecutionTarget } from "../execution-target-context";

const TERMINAL_EXECUTION_PHASES = new Set([
  ExecutionPhase.EXECUTION_COMPLETED,
  ExecutionPhase.EXECUTION_FAILED,
  ExecutionPhase.EXECUTION_CANCELLED,
  ExecutionPhase.EXECUTION_TERMINATED,
]);

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
  const adapter = useRunnerAdapter();
  const contextTarget = useExecutionTarget();
  const terminatedRef = useRef<string | null>(null);

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

  useEffect(() => {
    const phase = execution?.status?.phase;
    if (
      adapter &&
      contextTarget === "local" &&
      executionId &&
      phase != null &&
      TERMINAL_EXECUTION_PHASES.has(phase) &&
      terminatedRef.current !== executionId
    ) {
      terminatedRef.current = executionId;
      adapter.onWorkflowExecutionTerminated(executionId).catch(() => {});
    }
  }, [execution?.status?.phase, executionId, adapter, contextTarget]);

  useEffect(() => {
    terminatedRef.current = null;
  }, [executionId]);

  return { execution, isLoading, isRefetching, error, refetch };
}
