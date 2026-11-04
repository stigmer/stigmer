"use client";

import { useCallback, useState } from "react";
import type { Channel } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/api_pb";
import type { ChannelInput } from "@stigmer/client";
import { useStigmer } from "@stigmer/react-core";
import { toError } from "@stigmer/react-core/internal";

/** Return value of {@link useCreateChannel}. */
export interface UseCreateChannelReturn {
  /**
   * Create a new channel (strict create: an existing org + slug fails
   * with ALREADY_EXISTS rather than silently updating it — the reason
   * this is not `apply`). A Slack or WhatsApp channel comes back in
   * `pending_install` state; run the provider install flow next. A web
   * channel comes back serving its chat link.
   */
  readonly createChannel: (input: ChannelInput) => Promise<Channel>;
  /** `true` while the create request is in flight. */
  readonly isPending: boolean;
  /** Error from the last failed create, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Mutation hook that creates a {@link Channel} of any type.
 *
 * Wraps `stigmer.channel.create()` with loading/error state. An
 * agent can carry several channels (two Slack workspaces, a chat link per
 * site), all in one slug namespace, so a new channel must never overwrite
 * a sibling whose slug collides — strict-create semantics make that
 * mistake loud instead of silent. Updates and toggles go through
 * `useSaveChannel`.
 *
 * @example
 * ```tsx
 * import type { Channel } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/api_pb";
 *
 * function AddSlackChannelButton({ onCreated }: { onCreated: (channel: Channel) => void }) {
 *   const { createChannel, isPending } = useCreateChannel();
 *   const create = async () =>
 *     onCreated(await createChannel({ name: "Support Slack", org: "acme", agentRef: { org: "acme", slug: "support" }, enabled: true, slack: {} }));
 *   return <button onClick={create} disabled={isPending}>Add Slack channel</button>;
 * }
 * ```
 */
export function useCreateChannel(): UseCreateChannelReturn {
  const stigmer = useStigmer();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const createChannel = useCallback(
    async (input: ChannelInput): Promise<Channel> => {
      setIsPending(true);
      setError(null);

      try {
        return await stigmer.channel.create(input);
      } catch (err) {
        setError(toError(err));
        throw err;
      } finally {
        setIsPending(false);
      }
    },
    [stigmer],
  );

  return { createChannel, isPending, error, clearError };
}
