"use client";

import { useCallback, useState } from "react";
import type { Workflow } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import type { WorkflowInput } from "@stigmer/sdk";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** Return value of {@link useUpdateWorkflow}. */
export interface UseUpdateWorkflowReturn {
  /** Update an existing workflow with a full input. Returns the updated resource. */
  readonly update: (input: WorkflowInput) => Promise<Workflow>;
  /** `true` while the update RPC is in flight. */
  readonly isUpdating: boolean;
  /** Error from the last failed update, or `null` when healthy. */
  readonly error: Error | null;
  /** Clear the error state. */
  readonly clearError: () => void;
}

/**
 * Mutation hook that updates an existing Workflow resource.
 *
 * Wraps `stigmer.workflow.update(input)` with loading and error state.
 * The caller must provide a **complete** `WorkflowInput` -- the backend
 * performs full spec replacement. Use `workflowToInput()` to reconstruct
 * the input from a fetched workflow, modify the desired field, and pass
 * the result here.
 */
export function useUpdateWorkflow(): UseUpdateWorkflowReturn {
  const stigmer = useStigmer();
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const update = useCallback(
    async (input: WorkflowInput): Promise<Workflow> => {
      setIsUpdating(true);
      setError(null);

      try {
        return await stigmer.workflow.update(input);
      } catch (err) {
        setError(toError(err));
        throw err;
      } finally {
        setIsUpdating(false);
      }
    },
    [stigmer],
  );

  return { update, isUpdating, error, clearError };
}
