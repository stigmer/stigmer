"use client";

import { useCallback, useState } from "react";
import type { AgentChannel } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
import { buildAgentChannelProto, type AgentChannelInput } from "@stigmer/sdk";
import { useStigmer } from "../hooks.js";
import { maskedEdit } from "../internal/maskedEdit.js";
import { toError } from "../internal/toError.js";

/** Return value of {@link useSaveAgentChannel}. */
export interface UseSaveAgentChannelReturn {
  /**
   * Create an agent channel (`apply` semantics: upsert by org + slug).
   * Returns the persisted resource.
   */
  readonly save: (input: AgentChannelInput) => Promise<AgentChannel>;
  /**
   * Change the fields `patch` sets on an existing channel, as loaded:
   * the update names exactly those fields, so every other field (the
   * agent reference, the provider config, the bound vaults, the run
   * override) keeps its stored value, and a channel changed since it was
   * loaded refuses the save (ABORTED, reason `ETAG_MISMATCH`). A key set
   * to `undefined` clears that field. Returns the updated resource.
   *
   * Disabling is a config-preserving pause: `update(channel, { enabled:
   * false })` keeps the provider install and its credentials. Deleting is
   * the full teardown — see `useDeleteAgentChannel`.
   */
  readonly update: (
    channel: AgentChannel,
    patch: Partial<AgentChannelInput>,
  ) => Promise<AgentChannel>;
  /** `true` while a save or update is in flight. */
  readonly isPending: boolean;
  /** Error from the last failed save or update, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Mutation hook that creates or changes an {@link AgentChannel}.
 *
 * `save` wraps `stigmer.agentChannel.apply()` for a new channel; `update`
 * wraps `stigmer.agentChannel.update()` for an existing one, naming only
 * the fields its patch sets. The caller is responsible for post-save UI
 * updates (e.g. refreshing the channel list).
 *
 * @example
 * ```tsx
 * const { update, isPending } = useSaveAgentChannel();
 *
 * const handleToggle = async (channel: AgentChannel, enabled: boolean) => {
 *   await update(channel, { enabled });
 *   refetch(); // refresh the channel list
 * };
 * ```
 */
export function useSaveAgentChannel(): UseSaveAgentChannelReturn {
  const stigmer = useStigmer();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const track = useCallback(async (write: () => Promise<AgentChannel>): Promise<AgentChannel> => {
    setIsPending(true);
    setError(null);
    try {
      return await write();
    } catch (err) {
      setError(toError(err));
      throw err;
    } finally {
      setIsPending(false);
    }
  }, []);

  const save = useCallback(
    (input: AgentChannelInput) => track(() => stigmer.agentChannel.apply(input)),
    [stigmer, track],
  );

  const update = useCallback(
    (channel: AgentChannel, patch: Partial<AgentChannelInput>) =>
      track(() => {
        const { resource, paths } = maskedEdit(channel, buildAgentChannelProto, patch);
        return stigmer.agentChannel.update(resource, paths);
      }),
    [stigmer, track],
  );

  return { save, update, isPending, error, clearError };
}
