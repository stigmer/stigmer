"use client";

import { useEffect, useRef } from "react";
import type { WorkflowRun } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/api_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/enum_pb";
import { isNotFound } from "@stigmer/sdk";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";
import { useRunnerAdapter } from "../runner-adapter.js";
import { useExecutionTarget } from "../execution-target-context.js";

const TERMINAL_EXECUTION_PHASES = new Set([
  RunPhase.RUN_COMPLETED,
  RunPhase.RUN_FAILED,
  RunPhase.RUN_CANCELLED,
  RunPhase.RUN_TERMINATED,
]);

/** Return value of {@link useWorkflowRun}. */
export interface UseWorkflowRunReturn {
  /** The resolved run, or `null` while loading, on error, or when not found. */
  readonly run: WorkflowRun | null;
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
 * Data hook that fetches a single WorkflowRun by ID.
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
 *   const { run, isLoading, error } = useWorkflowRun(id);
 *   if (isLoading) return <Skeleton />;
 *   if (error) return <ErrorMessage error={error} />;
 *   if (!run) return <NotFound />;
 *   return <h2>{run.metadata?.name}</h2>;
 * }
 * ```
 */
export function useWorkflowRun(
  executionId: string | null,
): UseWorkflowRunReturn {
  const stigmer = useStigmer();
  const adapter = useRunnerAdapter();
  const contextTarget = useExecutionTarget();
  const terminatedRef = useRef<string | null>(null);

  const fetchFn = executionId
    ? async () => {
        try {
          return await stigmer.workflowRun.get(executionId);
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
    const fetchedId = execution?.metadata?.id;
    if (
      adapter &&
      contextTarget === "local" &&
      executionId &&
      phase != null &&
      TERMINAL_EXECUTION_PHASES.has(phase) &&
      fetchedId === executionId &&
      terminatedRef.current !== executionId
    ) {
      terminatedRef.current = executionId;
      adapter.onWorkflowRunTerminated(executionId).catch(() => {});
    }
  }, [execution?.status?.phase, execution?.metadata?.id, executionId, adapter, contextTarget]);

  useEffect(() => {
    terminatedRef.current = null;
  }, [executionId]);

  return { run: execution, isLoading, isRefetching, error, refetch };
}
