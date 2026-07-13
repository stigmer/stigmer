"use client";

import { useCallback, useState } from "react";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { AgentShare } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/api_pb";
import { AgentShareAudience } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/spec_pb";
import type { ResourceRef } from "@stigmer/sdk";
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
 * A complete share configuration to persist.
 *
 * Every field is required by design: saving **replaces the share's whole
 * spec**, so a caller must always supply the full configuration. A
 * partial type here would let a toggle change silently wipe
 * `allowedOrigins`, `messages`, `environmentRefs`, or the `audience` —
 * the required shape makes that mistake unrepresentable. (The rotatable
 * link token is exempt: it is server-owned `status`, which survives
 * every save verbatim.)
 */
export interface AgentShareDraft {
  /** Whether hosted-chat access for the configured audience is enabled. */
  readonly enabled: boolean;
  /** Who can chat: anyone with the link, or org members only. */
  readonly audience: SharingAudience;
  /**
   * Exact web origins allowed to embed the shared agent
   * (e.g. `https://example.com`). Empty list = embeddable anywhere.
   * Embedding is public-audience only.
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
  /**
   * Org-shared environments whose values guest conversations receive —
   * how a tool-using agent becomes chattable over a share link without
   * touching its pristine default instance. Public-audience only (the
   * proto CEL rule rejects bindings on org-audience shares, whose member
   * sessions carry no share linkage in Phase A — decision 011 addendum).
   */
  readonly environmentRefs: readonly ResourceRef[];
}

/**
 * Maps a proto {@link AgentShareAudience} to the SDK's string union.
 * Unspecified means public by contract (a share created without an
 * explicit audience is an anyone-with-link share).
 */
export function sharingAudienceFromProto(
  audience: AgentShareAudience | undefined,
): SharingAudience {
  return audience === AgentShareAudience.org ? "org" : "public";
}

function sharingAudienceToProto(audience: SharingAudience): AgentShareAudience {
  return audience === "org"
    ? AgentShareAudience.org
    : AgentShareAudience.public;
}

/** Return value of {@link useSaveAgentShare}. */
export interface UseSaveAgentShareReturn {
  /**
   * Persist the complete share configuration. Resolves with the
   * persisted {@link AgentShare} — adopt it as the new baseline (its
   * `status.shareLinkToken` carries the live link token).
   *
   * `current` is the share being edited, or `null` when the agent has
   * never been shared — the save then creates the canonical share.
   */
  readonly save: (
    draft: AgentShareDraft,
    current: AgentShare | null,
  ) => Promise<AgentShare | undefined>;
  /** `true` while the RPC is in flight. */
  readonly isPending: boolean;
  /** The last error from the RPC, or `null`. */
  readonly error: Error | null;
}

/**
 * Behavior hook that persists an agent's canonical share configuration.
 *
 * Commits via `stigmer.agentShare.apply()` — an idempotent upsert keyed
 * on the share's `(org, slug)` identity — so one code path serves both
 * the first enable (creates the share; the server authorizes on the
 * referenced agent's `can_edit`) and every later edit. There is
 * deliberately no create/update branching: the share slug is unique per
 * org and defaults to the agent's slug, which makes apply-by-identity
 * exact, and the generated `AgentShareInput` carries no `metadata.id`
 * for an update to route by anyway.
 *
 * Disabling is a save with `enabled: false` — a config-preserving pause
 * (decision 011 D1). Deleting the share is a separate, destructive
 * operation this hook does not perform.
 *
 * `shareOrg` selects which org's channel a first save creates and
 * defaults to the agent's own org. Pass the viewer's org to create a
 * **cross-org share** (decision 013) — the server then authorizes on the
 * public agent's `can_execute` plus `can_create_agent_share` in the
 * sharing org, and bills that org.
 *
 * Pass `null` for `agent` to produce a stable no-op (useful while the
 * agent is still loading).
 *
 * @example
 * ```tsx
 * const { share } = useAgentShare(agent);
 * const { save, isPending } = useSaveAgentShare(agent);
 *
 * const persisted = await save({ ...draft, enabled: true }, share);
 * // persisted.status.shareLinkToken is the live link token
 * ```
 */
export function useSaveAgentShare(
  agent: Agent | null,
  shareOrg?: string,
): UseSaveAgentShareReturn {
  const stigmer = useStigmer();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const agentOrg = agent?.metadata?.org ?? "";
  const agentSlug = agent?.metadata?.slug ?? "";
  const agentName = agent?.metadata?.name ?? "";
  const resolvedShareOrg = shareOrg || agentOrg;

  const save = useCallback(
    async (
      draft: AgentShareDraft,
      current: AgentShare | null,
    ): Promise<AgentShare | undefined> => {
      if (!agentOrg || !agentSlug) return undefined;

      setIsPending(true);
      setError(null);

      try {
        return await stigmer.agentShare.apply({
          // Identity: the existing share's org/slug when editing (a
          // manifest-created share may carry a non-default slug — apply
          // with the agent's slug would create a SECOND share), the
          // sharing org + the agent's slug when creating (the server's
          // own D2 default, made explicit).
          org: current?.metadata?.org || resolvedShareOrg,
          slug: current?.metadata?.slug || agentSlug,
          name: current?.metadata?.name || agentName || agentSlug,
          agentRef: { org: agentOrg, slug: agentSlug },
          enabled: draft.enabled,
          // Written as the explicit enum value, never left unspecified —
          // a share persisted as "public" can't be silently downgraded
          // by tooling that relies on the unspecified-means-public rule.
          audience: sharingAudienceToProto(draft.audience),
          allowedOrigins: [...draft.allowedOrigins],
          messages: {
            rateLimited: draft.messages.rateLimited,
            unavailable: draft.messages.unavailable,
            conversationEnded: draft.messages.conversationEnded,
          },
          environmentRefs: draft.environmentRefs.map((ref) => ({
            org: ref.org,
            slug: ref.slug,
          })),
        });
      } catch (err) {
        setError(toError(err));
        throw err;
      } finally {
        setIsPending(false);
      }
    },
    [agentOrg, agentSlug, agentName, resolvedShareOrg, stigmer],
  );

  return { save, isPending, error };
}
