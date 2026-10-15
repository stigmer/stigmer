"use client";

import { useCallback, useState } from "react";
import type { AgentChannel } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
import type { AgentChannelInput } from "@stigmer/sdk";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** Return value of {@link useCreateAgentChannel}. */
export interface UseCreateAgentChannelReturn {
  /**
   * Create a new agent channel (strict create: an existing org + slug
   * fails with ALREADY_EXISTS rather than silently updating it — the
   * reason this is not `apply`). Returns the created resource in
   * `pending_install` state; run the provider install flow next.
   */
  readonly createChannel: (input: AgentChannelInput) => Promise<AgentChannel>;
  /** `true` while the create request is in flight. */
  readonly isPending: boolean;
  /** Error from the last failed create, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Mutation hook that creates an {@link AgentChannel}.
 *
 * Wraps `stigmer.agentChannel.create()` with loading/error state. An
 * agent can carry several channels (e.g. two Slack workspaces), so a new
 * channel must never overwrite a sibling whose derived slug collides —
 * strict-create semantics make that mistake loud instead of silent.
 * Updates and toggles go through `useSaveAgentChannel` (apply).
 *
 * @example
 * ```tsx
 * const { createChannel, isPending } = useCreateAgentChannel();
 *
 * const channel = await createChannel({
 *   name: "Support Slack",
 *   org: agent.metadata.org,
 *   agentRef: { org: agent.metadata.org, slug: agent.metadata.slug },
 *   enabled: true,
 *   slack: {},
 * });
 * ```
 */
export function useCreateAgentChannel(): UseCreateAgentChannelReturn {
  const stigmer = useStigmer();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const createChannel = useCallback(
    async (input: AgentChannelInput): Promise<AgentChannel> => {
      setIsPending(true);
      setError(null);

      try {
        return await stigmer.agentChannel.create(input);
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
