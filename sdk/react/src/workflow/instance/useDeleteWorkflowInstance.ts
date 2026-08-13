"use client";

import { useCallback, useState } from "react";
import type { WorkflowInstance } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/api_pb";
import { useStigmer } from "../../hooks.js";
import { toError } from "../../internal/toError.js";

/** Return value of {@link useDeleteWorkflowInstance}. */
export interface UseDeleteWorkflowInstanceReturn {
  /**
   * Delete a workflow instance by ID. Returns the deleted resource.
   *
   * Deletion does NOT cascade to executions: runs already created
   * against the instance are preserved and stay visible in the parent
   * workflow's execution history (every execution carries a
   * denormalized workflow reference). Only the instance itself — its
   * environment bindings and configuration — is removed.
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
 * Deletion is instance-only on both editions — executions are NOT
 * cascaded (deliberate platform posture: they keep a denormalized
 * workflow reference and remain in the workflow's execution history).
 * Confirmation UI must not claim execution history is deleted.
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
