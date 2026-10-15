"use client";

import { useCallback, useState } from "react";
import type { AgentChannel } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** Return value of {@link useDeleteAgentChannel}. */
export interface UseDeleteAgentChannelReturn {
  /**
   * Delete an agent channel by ID. Returns the deleted resource.
   *
   * Deleting a channel is full teardown: the provider connection stops
   * serving immediately and the stored install (including its
   * credentials) is removed. To stop serving while keeping the install,
   * save the channel with `enabled: false` instead (a config-preserving
   * pause via `useSaveAgentChannel`).
   */
  readonly deleteChannel: (id: string) => Promise<AgentChannel>;
  /** `true` while the delete request is in flight. */
  readonly isDeleting: boolean;
  /** Error from the last failed delete, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Mutation hook that deletes an {@link AgentChannel} resource.
 *
 * Wraps `stigmer.agentChannel.delete()` with loading/error state. The
 * caller is responsible for post-delete UI updates (e.g. refreshing the
 * channel list) and for confirming the destructive action — the
 * delete-vs-pause distinction belongs in the confirmation copy.
 *
 * @example
 * ```tsx
 * const { deleteChannel, isDeleting } = useDeleteAgentChannel();
 *
 * const handleDelete = async () => {
 *   await deleteChannel(channel.metadata.id);
 *   refetch(); // refresh the channel list
 * };
 * ```
 */
export function useDeleteAgentChannel(): UseDeleteAgentChannelReturn {
  const stigmer = useStigmer();
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const deleteChannel = useCallback(
    async (id: string): Promise<AgentChannel> => {
      setIsDeleting(true);
      setError(null);

      try {
        return await stigmer.agentChannel.delete(id);
      } catch (err) {
        setError(toError(err));
        throw err;
      } finally {
        setIsDeleting(false);
      }
    },
    [stigmer],
  );

  return { deleteChannel, isDeleting, error, clearError };
}
