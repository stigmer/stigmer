"use client";

import { useCallback, useState } from "react";
import { create } from "@bufbuild/protobuf";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { UpdateAgentSharingInputSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/io_pb";
import {
  AgentSharingSchema,
  AgentSharingMessagesSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/**
 * A complete sharing configuration to persist.
 *
 * Every field is required by design: the `updateSharing` RPC **replaces**
 * the agent's whole `spec.sharing` block, so a caller must always supply
 * the full configuration. A partial type here would let a toggle change
 * silently wipe `allowedOrigins` or `messages` — the required shape makes
 * that mistake unrepresentable.
 */
export interface AgentSharingDraft {
  /** Whether anyone with the link can chat with this agent. */
  readonly enabled: boolean;
  /**
   * Exact web origins allowed to embed the shared agent
   * (e.g. `https://example.com`). Stored now; enforced by the embed
   * widget's Origin check.
   */
  readonly allowedOrigins: readonly string[];
  /** Owner-customized visitor refusal copy. Empty strings mean platform defaults. */
  readonly messages: {
    /** Shown when a visitor exceeds the message rate limit. */
    readonly rateLimited: string;
    /** Shown when the org's credits are exhausted (sharing fails closed). */
    readonly unavailable: string;
    /** Shown when a conversation hits its turn limit or inactivity timeout. */
    readonly conversationEnded: string;
  };
}

/** Return value of {@link useUpdateAgentSharing}. */
export interface UseUpdateAgentSharingReturn {
  /**
   * Persist the complete sharing configuration via the `updateSharing`
   * RPC. Resolves with the updated agent.
   */
  readonly updateSharing: (draft: AgentSharingDraft) => Promise<Agent | undefined>;
  /** `true` while the RPC is in flight. */
  readonly isPending: boolean;
  /** The last error from the RPC, or `null`. */
  readonly error: Error | null;
}

/**
 * Behavior hook that updates an agent's sharing configuration.
 *
 * Wraps the targeted `stigmer.agent.updateSharing()` RPC (authorized by
 * `can_edit`) with loading and error state management. The hook is
 * stateless with respect to the agent — the caller refreshes the resource
 * after a successful update (e.g. via `refetch` from `useAgent`), matching
 * the {@link useUpdateVisibility} convention.
 *
 * Pass `null` for `agentId` to produce a stable no-op (useful while the
 * agent is still loading).
 *
 * @example
 * ```tsx
 * const { updateSharing, isPending } = useUpdateAgentSharing(agent.metadata.id);
 *
 * await updateSharing({
 *   enabled: true,
 *   allowedOrigins: ["https://example.com"],
 *   messages: { rateLimited: "", unavailable: "", conversationEnded: "" },
 * });
 * refetch();
 * ```
 */
export function useUpdateAgentSharing(
  agentId: string | null,
): UseUpdateAgentSharingReturn {
  const stigmer = useStigmer();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const updateSharing = useCallback(
    async (draft: AgentSharingDraft): Promise<Agent | undefined> => {
      if (!agentId) return undefined;

      setIsPending(true);
      setError(null);

      try {
        const input = create(UpdateAgentSharingInputSchema, {
          resourceId: agentId,
          sharing: create(AgentSharingSchema, {
            enabled: draft.enabled,
            allowedOrigins: [...draft.allowedOrigins],
            messages: create(AgentSharingMessagesSchema, {
              rateLimited: draft.messages.rateLimited,
              unavailable: draft.messages.unavailable,
              conversationEnded: draft.messages.conversationEnded,
            }),
          }),
        });
        return await stigmer.agent.updateSharing(input);
      } catch (err) {
        setError(toError(err));
        throw err;
      } finally {
        setIsPending(false);
      }
    },
    [agentId, stigmer],
  );

  return { updateSharing, isPending, error };
}
