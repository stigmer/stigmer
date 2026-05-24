"use client";

import type { WorkflowInstance } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/api_pb";
import { useStigmer } from "../../hooks";
import { useFetch } from "../../internal/useFetch";

/** Return value of {@link useWorkflowInstance}. */
export interface UseWorkflowInstanceReturn {
  /** The fetched WorkflowInstance, or `null` while loading or on error. */
  readonly instance: WorkflowInstance | null;
  /** `true` while the initial fetch is in flight. */
  readonly isLoading: boolean;
  /** `true` while a background refetch is in flight and stale data is shown. */
  readonly isRefetching: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch the instance from the server. */
  readonly refetch: () => void;
}

/**
 * Data hook that fetches a single WorkflowInstance by ID.
 *
 * Wraps `stigmer.workflowInstance.get()` with loading and error state.
 * Pass `null` or `undefined` as `instanceId` to skip fetching (stable no-op).
 *
 * @example
 * ```tsx
 * const { instance, isLoading } = useWorkflowInstance(selectedInstanceId);
 * ```
 */
export function useWorkflowInstance(
  instanceId: string | null | undefined,
): UseWorkflowInstanceReturn {
  const stigmer = useStigmer();

  const fetchFn = instanceId
    ? async () => stigmer.workflowInstance.get(instanceId)
    : null;

  const {
    data: instance,
    isLoading,
    isRefetching,
    error,
    refetch,
  } = useFetch<WorkflowInstance | null>(fetchFn, [instanceId, stigmer], null);

  return { instance, isLoading, isRefetching, error, refetch };
}
