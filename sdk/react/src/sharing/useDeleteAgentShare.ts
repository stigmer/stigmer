"use client";

import { useCallback, useState } from "react";
import type { AgentShare } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/api_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** Return value of {@link useDeleteAgentShare}. */
export interface UseDeleteAgentShareReturn {
  /**
   * Delete an agent share by ID. Returns the deleted resource.
   *
   * Deleting a share is full teardown (decision 011 D1): its hosted
   * link dies immediately — including for visitors mid-conversation —
   * and its configuration (origins, messages, credential bindings, link
   * token) is gone. To stop serving while keeping the configuration,
   * save the share with `enabled: false` instead (a config-preserving
   * pause via {@link useSaveAgentShare}).
   */
  readonly deleteShare: (id: string) => Promise<AgentShare>;
  /** `true` while the delete request is in flight. */
  readonly isDeleting: boolean;
  /** Error from the last failed delete, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Mutation hook that deletes an {@link AgentShare} resource.
 *
 * Wraps `stigmer.agentShare.delete()` (authorized by the share's
 * `can_delete`) with loading/error state. The caller is responsible for
 * post-delete UI updates (e.g. refreshing the share list) and for
 * confirming the destructive action — the delete-vs-pause distinction
 * belongs in the confirmation copy.
 *
 * @example
 * ```tsx
 * const { deleteShare, isDeleting } = useDeleteAgentShare();
 *
 * const handleDelete = async () => {
 *   await deleteShare(share.metadata.id);
 *   refetch(); // refresh the share list
 * };
 * ```
 */
export function useDeleteAgentShare(): UseDeleteAgentShareReturn {
  const stigmer = useStigmer();
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const deleteShare = useCallback(
    async (id: string): Promise<AgentShare> => {
      setIsDeleting(true);
      setError(null);

      try {
        return await stigmer.agentShare.delete(id);
      } catch (err) {
        setError(toError(err));
        throw err;
      } finally {
        setIsDeleting(false);
      }
    },
    [stigmer],
  );

  return { deleteShare, isDeleting, error, clearError };
}
