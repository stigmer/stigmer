"use client";

/**
 * Mutation hook for a workflow's run visibility: who may observe every run
 * of the workflow, past runs included. The setting lives on the workflow
 * and has one door, `WorkflowCommandController.updateExecutionVisibility`,
 * which the server gates on `can_manage_audience`; a plain workflow update
 * keeps the stored level, so this hook is the only writer.
 *
 * Pinned through the control by `__tests__/RunVisibilityControl.test.tsx`.
 */

import { useCallback, useMemo, useState } from "react";
import { create } from "@bufbuild/protobuf";
import type { Workflow } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import type { WorkflowRunVisibility } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import { UpdateWorkflowRunVisibilityInputSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** Return value of {@link useUpdateWorkflowExecutionVisibility}. */
export interface UseUpdateWorkflowExecutionVisibilityReturn {
  /**
   * Set who can observe the runs of a workflow. Distinct from the
   * workflow's own visibility: a workflow the organization can see and run
   * still keeps each person's runs private until this is raised.
   * Resolves with the updated workflow.
   */
  readonly updateExecutionVisibility: (
    workflowId: string,
    executionVisibility: WorkflowRunVisibility,
  ) => Promise<Workflow>;
  /** `true` while the update RPC is in flight. */
  readonly isUpdating: boolean;
  /** Error from the last failed update, or `null` when healthy. */
  readonly error: Error | null;
  /** Clear the error state. */
  readonly clearError: () => void;
}

/**
 * Wraps `stigmer.workflow.updateExecutionVisibility()` with loading and
 * error state. The caller refreshes the workflow after a successful update.
 */
export function useUpdateWorkflowExecutionVisibility(): UseUpdateWorkflowExecutionVisibilityReturn {
  const stigmer = useStigmer();
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const updateExecutionVisibility = useCallback(
    async (
      workflowId: string,
      executionVisibility: WorkflowRunVisibility,
    ): Promise<Workflow> => {
      setIsUpdating(true);
      setError(null);

      try {
        return await stigmer.workflow.updateRunVisibility(
          create(UpdateWorkflowRunVisibilityInputSchema, {
            resourceId: workflowId,
            runVisibility: executionVisibility,
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

  return useMemo(
    () => ({ updateExecutionVisibility, isUpdating, error, clearError }),
    [updateExecutionVisibility, isUpdating, error, clearError],
  );
}
