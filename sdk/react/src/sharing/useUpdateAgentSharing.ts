"use client";

import { useCallback, useState } from "react";
import { create } from "@bufbuild/protobuf";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { UpdateAgentSharingInputSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/io_pb";
import {
  AgentSharingAudience,
  AgentSharingSchema,
  AgentSharingMessagesSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/**
 * Who can chat with a shared agent over its hosted link.
 *
 * - `"public"` — anyone with the link; visitors are anonymous guests.
 * - `"org"` — signed-in members of the owning organization only.
 *   Membership is checked on every conversation turn, so access ends the
 *   moment a member leaves the org.
 */
export type SharingAudience = "public" | "org";

/**
 * A complete sharing configuration to persist.
 *
 * Every field is required by design: the `updateSharing` RPC **replaces**
 * the agent's whole `spec.sharing` block, so a caller must always supply
 * the full configuration. A partial type here would let a toggle change
 * silently wipe `allowedOrigins`, `messages`, or the `audience` — the
 * required shape makes that mistake unrepresentable.
 */
export interface AgentSharingDraft {
  /** Whether hosted-chat access for the configured audience is enabled. */
  readonly enabled: boolean;
  /** Who can chat: anyone with the link, or org members only. */
  readonly audience: SharingAudience;
  /**
   * Exact web origins allowed to embed the shared agent
   * (e.g. `https://example.com`). Stored now; enforced by the embed
   * widget's Origin check. Embedding is public-audience only.
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

/**
 * Maps a proto {@link AgentSharingAudience} to the SDK's string union.
 * Unspecified means public by contract (pre-audience shares keep their
 * anyone-with-link behavior).
 */
export function sharingAudienceFromProto(
  audience: AgentSharingAudience | undefined,
): SharingAudience {
  return audience === AgentSharingAudience.org ? "org" : "public";
}

function sharingAudienceToProto(audience: SharingAudience): AgentSharingAudience {
  return audience === "org"
    ? AgentSharingAudience.org
    : AgentSharingAudience.public;
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
 *   audience: "public",
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
            audience: sharingAudienceToProto(draft.audience),
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
