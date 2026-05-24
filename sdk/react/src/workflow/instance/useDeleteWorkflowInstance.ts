"use client";

import { useCallback, useState } from "react";
import type { WorkflowInstance } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/api_pb";
import { useStigmer } from "../../hooks";
import { toError } from "../../internal/toError";

/** Return value of {@link useDeleteWorkflowInstance}. */
export interface UseDeleteWorkflowInstanceReturn {
  /**
   * Delete a workflow instance by ID. Returns the deleted resource.
   *
   * WARNING: Deleting an instance cascades — all executions belonging
   * to this instance are permanently removed.
   */
  readonly deleteInstance: (id: string) => Promise<WorkflowInstance>;
  /** `true` while the delete request is in flight. */
  readonly isDeleting: boolean;
  /** Error from the last failed delete, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Mutation hook that deletes a WorkflowInstance resource.
 *
 * Wraps `stigmer.workflowInstance.delete()` with loading/error state.
 * The caller is responsible for handling post-delete UI updates
 * (e.g., refreshing the instance list, closing a detail panel).
 *
 * Deletion cascades to all WorkflowExecution resources that belong
 * to the instance. The confirmation UI should warn the user about this.
 *
 * @example
 * ```tsx
 * const { deleteInstance, isDeleting } = useDeleteWorkflowInstance();
 *
 * const handleDelete = async () => {
 *   await deleteInstance(instance.metadata.id);
 *   refetch(); // refresh list after deletion
 * };
 * ```
 */
export function useDeleteWorkflowInstance(): UseDeleteWorkflowInstanceReturn {
  const stigmer = useStigmer();
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const deleteInstance = useCallback(
    async (id: string): Promise<WorkflowInstance> => {
      setIsDeleting(true);
      setError(null);

      try {
        return await stigmer.workflowInstance.delete(id);
      } catch (err) {
        setError(toError(err));
        throw err;
      } finally {
        setIsDeleting(false);
      }
    },
    [stigmer],
  );

  return { deleteInstance, isDeleting, error, clearError };
}
