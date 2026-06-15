"use client";

import { useCallback, useState } from "react";
import { create } from "@bufbuild/protobuf";
import type { WorkflowInstance } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/api_pb";
import { UpdateExecutionVisibilityInputSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/io_pb";
import type { WorkflowExecutionVisibility } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/spec_pb";
import { useStigmer } from "../../hooks";
import { toError } from "../../internal/toError";

/** Return value of {@link useUpdateWorkflowInstanceExecutionVisibility}. */
export interface UseUpdateWorkflowInstanceExecutionVisibilityReturn {
  /**
   * Update who can observe the runs (executions) of a workflow instance.
   *
   * This is distinct from the instance's own visibility: it controls run
   * observability via the `workflow_instance#execution_viewer` relation,
   * letting an owner keep the instance private while opting all org members
   * into watching its executions.
   */
  readonly updateExecutionVisibility: (
    resourceId: string,
    executionVisibility: WorkflowExecutionVisibility,
  ) => Promise<WorkflowInstance>;
  /** `true` while the update RPC is in flight. */
  readonly isUpdating: boolean;
  /** Error from the last failed update, or `null` when healthy. */
  readonly error: Error | null;
  /** Clear the error state. */
  readonly clearError: () => void;
}

/**
 * Mutation hook that updates the execution (run) visibility of a
 * WorkflowInstance.
 *
 * Wraps `stigmer.workflowInstance.updateExecutionVisibility()` with
 * loading/error state. The caller is responsible for refreshing the instance
 * after a successful update.
 */
export function useUpdateWorkflowInstanceExecutionVisibility(): UseUpdateWorkflowInstanceExecutionVisibilityReturn {
  const stigmer = useStigmer();
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const updateExecutionVisibility = useCallback(
    async (
      resourceId: string,
      executionVisibility: WorkflowExecutionVisibility,
    ): Promise<WorkflowInstance> => {
      setIsUpdating(true);
      setError(null);

      try {
        return await stigmer.workflowInstance.updateExecutionVisibility(
          create(UpdateExecutionVisibilityInputSchema, {
            resourceId,
            executionVisibility,
          }),
        );
      } catch (err) {
        setError(toError(err));
        throw err;
      } finally {
        setIsUpdating(false);
      }
    },
    [stigmer],
  );

  return { updateExecutionVisibility, isUpdating, error, clearError };
}
