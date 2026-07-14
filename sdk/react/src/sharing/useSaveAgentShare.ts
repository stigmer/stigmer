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

/**
 * Projects a share into the editable {@link AgentShareDraft} — the
 * single constructor for the full-spec drafts every save requires.
 * `null` (no share yet) seeds the same defaults the server would apply
 * on first create.
 *
 * Shared by the Share dialog (draft seeding) and the share list's
 * pause/resume toggle, so a toggle rebuilds the complete spec with only
 * `enabled` flipped and can never wipe origins, messages, or credential
 * bindings — the fails-closed posture {@link AgentShareDraft} exists to
 * enforce.
 */
export function draftFromShare(share: AgentShare | null): AgentShareDraft {
  const spec = share?.spec;
  return {
    enabled: spec?.enabled ?? false,
    audience: sharingAudienceFromProto(spec?.audience),
    allowedOrigins: spec?.allowedOrigins ?? [],
    messages: {
      rateLimited: spec?.messages?.rateLimited ?? "",
      unavailable: spec?.messages?.unavailable ?? "",
      conversationEnded: spec?.messages?.conversationEnded ?? "",
    },
    environmentRefs: (spec?.environmentRefs ?? []).map((ref) => ({
      org: ref.org,
      slug: ref.slug,
    })),
  };
}

/**
 * Identity for a share being created: its display name and URL slug in
 * the sharing org's namespace. Only consulted when `current` is `null`
 * — an existing share's identity is immutable (decision 011 D2).
 */
export interface AgentShareCreateIdentity {
  /** Display name for the new share. */
  readonly name: string;
  /** URL slug for the new share — appears in `/chat/<org>/<slug>`. */
  readonly slug: string;
}

/** Return value of {@link useSaveAgentShare}. */
export interface UseSaveAgentShareReturn {
  /**
   * Persist the complete share configuration. Resolves with the
   * persisted {@link AgentShare} — adopt it as the new baseline (its
   * `status.shareLinkToken` carries the live link token).
   *
   * `current` is the share being edited, or `null` to create one —
   * named by `createIdentity` when given, else the server's defaults
   * (the agent's own name and slug).
   */
  readonly save: (
    draft: AgentShareDraft,
    current: AgentShare | null,
    createIdentity?: AgentShareCreateIdentity,
  ) => Promise<AgentShare | undefined>;
  /** `true` while the RPC is in flight. */
  readonly isPending: boolean;
  /** The last error from the RPC, or `null`. */
  readonly error: Error | null;
}

/**
 * Behavior hook that persists an agent share's configuration.
 *
 * Commits via `stigmer.agentShare.apply()` — an idempotent upsert keyed
 * on the share's `(org, slug)` identity — so one code path serves both
 * creation (the server authorizes on the referenced agent's `can_edit`)
 * and every later edit. There is deliberately no create/update
 * branching: the share slug is unique per org, which makes
 * apply-by-identity exact, and the generated `AgentShareInput` carries
 * no `metadata.id` for an update to route by anyway. A create that
 * collides on `(org, slug)` rejects with an already-exists error rather
 * than touching the existing share.
 *
 * Disabling is a save with `enabled: false` — a config-preserving pause
 * (decision 011 D1). Deleting the share is a separate, destructive
 * operation ({@link useDeleteAgentShare}).
 *
 * `shareOrg` selects which org owns a created share and defaults to the
 * agent's own org. Pass the viewer's org to create a **cross-org
 * share** (decision 013) — the server then authorizes on the public
 * agent's `can_execute` plus `can_create_agent_share` in the sharing
 * org, and bills that org.
 *
 * Pass `null` for `agent` to produce a stable no-op (useful while the
 * agent is still loading).
 *
 * @example
 * ```tsx
 * const { save, isPending } = useSaveAgentShare(agent);
 *
 * const persisted = await save({ ...draftFromShare(share), enabled: true }, share);
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
      createIdentity?: AgentShareCreateIdentity,
    ): Promise<AgentShare | undefined> => {
      if (!agentOrg || !agentSlug) return undefined;

      setIsPending(true);
      setError(null);

      try {
        return await stigmer.agentShare.apply({
          // Identity: the existing share's org/slug when editing (a
          // share may carry a non-default slug — apply with the agent's
          // slug would create a SECOND share); when creating, the
          // sharing org + the caller-chosen identity, falling back to
          // the agent's own slug/name (the server's D2 default, made
          // explicit).
          org: current?.metadata?.org || resolvedShareOrg,
          slug: current?.metadata?.slug || createIdentity?.slug || agentSlug,
          name:
            current?.metadata?.name ||
            createIdentity?.name ||
            agentName ||
            agentSlug,
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
