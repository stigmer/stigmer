"use client";

import { useCallback, useState } from "react";
import type { AgentInstance } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/api_pb";
import { useStigmer } from "../hooks";
import { toError } from "../internal/toError";

/** Return value of {@link useDeleteAgentInstance}. */
export interface UseDeleteAgentInstanceReturn {
  /**
   * Delete an agent instance by ID. Returns the deleted resource.
   *
   * Deleting an instance removes its configuration and environment
   * bindings. Sessions already started against it (and their execution
   * history) are preserved — deletion does not cascade to sessions.
   */
  readonly deleteInstance: (id: string) => Promise<AgentInstance>;
  /** `true` while the delete request is in flight. */
  readonly isDeleting: boolean;
  /** Error from the last failed delete, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Mutation hook that deletes an AgentInstance resource.
 *
 * Wraps `stigmer.agentInstance.delete()` with loading/error state.
 * The caller is responsible for handling post-delete UI updates
 * (e.g., refreshing the instance list, closing a detail panel).
 *
 * Unlike WorkflowInstance, deletion does **not** cascade to runtime
 * resources: sessions previously started against the instance and
 * their execution history remain intact. The confirmation UI copy
 * should reflect this.
 *
 * @example
 * ```tsx
 * const { deleteInstance, isDeleting } = useDeleteAgentInstance();
 *
 * const handleDelete = async () => {
 *   await deleteInstance(instance.metadata.id);
 *   refetch(); // refresh list after deletion
 * };
 * ```
 */
export function useDeleteAgentInstance(): UseDeleteAgentInstanceReturn {
  const stigmer = useStigmer();
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const deleteInstance = useCallback(
    async (id: string): Promise<AgentInstance> => {
      setIsDeleting(true);
      setError(null);

      try {
        return await stigmer.agentInstance.delete(id);
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
