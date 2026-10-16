"use client";

import { useCallback, useState } from "react";
import type { Channel } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/api_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** Return value of {@link useDeleteChannel}. */
export interface UseDeleteChannelReturn {
  /**
   * Delete a channel by ID. Returns the deleted resource.
   *
   * Deleting a channel is full teardown: it stops serving immediately —
   * a chat link dies for visitors mid-conversation, a Slack or WhatsApp
   * connection's stored install (including its credentials) is removed —
   * and its configuration is gone. To stop serving while keeping the
   * configuration, save the channel with `enabled: false` instead (a
   * config-preserving pause via `useSaveChannel`).
   */
  readonly deleteChannel: (id: string) => Promise<Channel>;
  /** `true` while the delete request is in flight. */
  readonly isDeleting: boolean;
  /** Error from the last failed delete, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Mutation hook that deletes a {@link Channel} of any type.
 *
 * Wraps `stigmer.channel.delete()` (authorized by the channel's
 * `can_delete`) with loading/error state. The
 * caller is responsible for post-delete UI updates (e.g. refreshing the
 * channel list) and for confirming the destructive action — the
 * delete-vs-pause distinction belongs in the confirmation copy.
 *
 * @example
 * ```tsx
 * const { deleteChannel, isDeleting } = useDeleteChannel();
 *
 * const handleDelete = async () => {
 *   await deleteChannel(channel.metadata.id);
 *   refetch(); // refresh the channel list
 * };
 * ```
 */
export function useDeleteChannel(): UseDeleteChannelReturn {
  const stigmer = useStigmer();
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const deleteChannel = useCallback(
    async (id: string): Promise<Channel> => {
      setIsDeleting(true);
      setError(null);

      try {
        return await stigmer.channel.delete(id);
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
