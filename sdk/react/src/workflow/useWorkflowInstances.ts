"use client";

import type { WorkflowInstance } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/api_pb";
import { create } from "@bufbuild/protobuf";
import { GetWorkflowInstancesByWorkflowRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/io_pb";
import { useStigmer } from "../hooks";
import { useFetch } from "../internal/useFetch";

/** Return value of {@link useWorkflowInstances}. */
export interface UseWorkflowInstancesReturn {
  /** Instances for the given workflow, or empty array while loading. */
  readonly instances: readonly WorkflowInstance[];
  /** `true` while the initial fetch or a refetch is in flight. */
  readonly isLoading: boolean;
  /** `true` while a background refetch is in flight and stale data is shown. */
  readonly isRefetching: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch instances from the server. */
  readonly refetch: () => void;
}

/**
 * Data hook that fetches all instances for a specific workflow.
 *
 * Wraps `stigmer.workflowInstance.getByWorkflow()` with loading
 * and error state management. Used on the Workflow detail page
 * "Instances" tab to show environment-bound deployments.
 *
 * Pass `null` as `workflowId` to skip fetching (stable no-op).
 *
 * @example
 * ```tsx
 * const { instances, isLoading } = useWorkflowInstances(workflow.metadata?.id);
 * ```
 */
export function useWorkflowInstances(
  workflowId: string | null | undefined,
): UseWorkflowInstancesReturn {
  const stigmer = useStigmer();

  const fetchFn = workflowId
    ? async () => {
        const resp = await stigmer.workflowInstance.getByWorkflow(
          create(GetWorkflowInstancesByWorkflowRequestSchema, {
            workflowId,
          }),
        );
        return resp.entries ? [...resp.entries] : [];
      }
    : null;

  const {
    data: instances,
    isLoading,
    isRefetching,
    error,
    refetch,
  } = useFetch<readonly WorkflowInstance[]>(fetchFn, [workflowId, stigmer], []);

  return { instances, isLoading, isRefetching, error, refetch };
}
