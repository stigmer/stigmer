"use client";

import { useCallback, useState } from "react";
import type { WorkflowInstance } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/api_pb";
import type { WorkflowInstanceInput } from "@stigmer/sdk";
import { useStigmer } from "../../hooks.js";
import { toError } from "../../internal/toError.js";

/** Return value of {@link useUpdateWorkflowInstance}. */
export interface UseUpdateWorkflowInstanceReturn {
  /** Update an existing workflow instance with a full input. Returns the updated resource. */
  readonly update: (input: WorkflowInstanceInput) => Promise<WorkflowInstance>;
  /** `true` while the update RPC is in flight. */
  readonly isUpdating: boolean;
  /** Error from the last failed update, or `null` when healthy. */
  readonly error: Error | null;
  /** Clear the error state. */
  readonly clearError: () => void;
}

/**
 * Mutation hook that updates an existing WorkflowInstance resource.
 *
 * Wraps `stigmer.workflowInstance.update()` with loading/error state.
 * The caller is responsible for refreshing the instance after a successful
 * update (e.g., via `refetch` from `useWorkflowInstances` or `useWorkflowInstance`).
 *
 * @example
 * ```tsx
 * const { update, isUpdating } = useUpdateWorkflowInstance();
 *
 * const handleSave = async () => {
 *   await update({
 *     ...instanceToInput(instance),
 *     environmentRefs: newRefs,
 *   });
 *   refetch();
 * };
 * ```
 */
export function useUpdateWorkflowInstance(): UseUpdateWorkflowInstanceReturn {
  const stigmer = useStigmer();
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const update = useCallback(
    async (input: WorkflowInstanceInput): Promise<WorkflowInstance> => {
      setIsUpdating(true);
      setError(null);

      try {
        return await stigmer.workflowInstance.update(input);
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
