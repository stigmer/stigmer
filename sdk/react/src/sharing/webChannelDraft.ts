"use client";

import { useCallback, useState } from "react";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { AgentShare } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/api_pb";
import { AgentShareAudience } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/spec_pb";
import { buildAgentShareProto, type AgentShareInput, type ResourceRef, type RunConfigInput } from "@stigmer/sdk";
import { useStigmer } from "../hooks.js";
import { maskedEdit } from "../internal/maskedEdit.js";
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
 * A complete share configuration, as the Share dialog edits it.
 *
 * Every field is required so a create carries a whole configuration. An
 * edit of an existing share names only the fields it saves (all of them
 * by default, or the ones the caller passes as `fields`), on the share as
 * loaded with the etag it was read at, so a field it does not name keeps
 * its stored value. (The rotatable link token is server-owned `status`,
 * which no save touches.)
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
    /** Shown when the share cannot serve the conversation, e.g. the org holds no provider key for the agent's model (fails closed). */
    readonly unavailable: string;
    /** Shown when a conversation hits its turn limit or inactivity timeout. */
    readonly conversationEnded: string;
  };
  /**
   * Shared vaults whose keys guest conversations use, in order —
   * how a tool-using agent becomes chattable over a share link without
   * touching the agent itself. Public-audience only (the
   * proto CEL rule rejects bindings on org-audience shares, whose member
   * sessions carry no share linkage).
   */
  readonly vaults: readonly ResourceRef[];
  /**
   * The owner's per-share run override (model / cost cap / tool
   * rounds / service tier), merged over the platform guest profile at
   * run time — stigmer/stigmer#360. The console does not edit it (yet):
   * it is saved back as loaded with the rest of the dialog's fields.
   * Public-audience only (the same proto CEL rule as vaults, for the
   * same reason).
   */
  readonly runConfig: RunConfigInput | undefined;
}

/**
 * Maps a proto {@link AgentShareAudience} to the SDK's string union.
 * Only an explicit public audience is "public": unspecified means the
 * organization's members by contract, so a share reaches the internet
 * only when someone chose "Anyone with the link".
 */
export function sharingAudienceFromProto(
  audience: AgentShareAudience | undefined,
): SharingAudience {
  return audience === AgentShareAudience.public ? "public" : "org";
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
 * pause/resume toggle, which saves `enabled` alone.
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
    vaults: (spec?.vaults ?? []).map((ref) => ({
      org: ref.org,
      slug: ref.slug,
    })),
    runConfig: spec?.runConfig
      ? {
          modelName: spec.runConfig.modelName,
          maxCostUsd: spec.runConfig.maxCostUsd,
          maxToolRounds: spec.runConfig.maxToolRounds,
          serviceTier: spec.runConfig.serviceTier,
          thinkingMode: spec.runConfig.thinkingMode,
          maxToolResultChars: spec.runConfig.maxToolResultChars,
        }
      : undefined,
  };
}

/**
 * Identity for a share being created: its display name and its slug in
 * the sharing org's namespace. Only consulted when `current` is `null`
 * — an existing share's identity is immutable.
 */
export interface AgentShareCreateIdentity {
  /** Display name for the new share. */
  readonly name: string;
  /**
   * Slug for the new share: its name in its organization, as the CLI and
   * API address it. The hosted chat link names the share by its id.
   */
  readonly slug: string;
}

/** Return value of {@link useSaveAgentShare}. */
export interface UseSaveAgentShareReturn {
  /**
   * Persist the share configuration. Resolves with the persisted
   * {@link AgentShare} — adopt it as the new baseline (its
   * `status.shareLinkToken` carries the live link token).
   *
   * `current` is the share being edited, or `null` to create one —
   * named by `createIdentity` when given, else the server's defaults
   * (the agent's own name and slug). An edit names `fields` (every
   * draft field when omitted); a share changed since `current` was
   * read refuses it (ABORTED, reason `ETAG_MISMATCH`).
   */
  readonly save: (
    draft: AgentShareDraft,
    current: AgentShare | null,
    createIdentity?: AgentShareCreateIdentity,
    fields?: ReadonlyArray<keyof AgentShareDraft>,
  ) => Promise<AgentShare | undefined>;
  /** `true` while the RPC is in flight. */
  readonly isPending: boolean;
  /** The last error from the RPC, or `null`. */
  readonly error: Error | null;
}

/**
 * Behavior hook that persists an agent share's configuration.
 *
 * A create goes through `stigmer.agentShare.apply()` (the server
 * authorizes on the referenced agent's `can_manage_audience` and the
 * organization's `can_create_agent_share`); a create that collides on
 * `(org, slug)` rejects with an already-exists error rather than touching
 * the existing share. An edit is `stigmer.agentShare.update()` on the
 * share as loaded, naming the fields it saves, so a teammate's change to
 * another field stays.
 *
 * Disabling is a save with `enabled: false` — a config-preserving pause.
 * Deleting the share is a separate, destructive
 * operation ({@link useDeleteAgentShare}).
 *
 * A created share lives in the agent's own organization: the share's URL,
 * billing and credential bindings all belong to the organization that
 * owns the agent, and the server refuses an `agent_ref` in any other. To
 * share another organization's agent, install the plugin that carries it
 * and share the installed copy.
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
): UseSaveAgentShareReturn {
  const stigmer = useStigmer();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const agentOrg = agent?.metadata?.org ?? "";
  const agentSlug = agent?.metadata?.slug ?? "";
  const agentName = agent?.metadata?.name ?? "";

  const save = useCallback(
    async (
      draft: AgentShareDraft,
      current: AgentShare | null,
      createIdentity?: AgentShareCreateIdentity,
      fields?: ReadonlyArray<keyof AgentShareDraft>,
    ): Promise<AgentShare | undefined> => {
      if (!agentOrg || !agentSlug) return undefined;

      setIsPending(true);
      setError(null);

      try {
        const settings = shareSettingsOf(draft);
        if (current !== null) {
          const named = fields ?? (Object.keys(settings) as Array<keyof AgentShareDraft>);
          const patch = Object.fromEntries(named.map((field) => [field, settings[field]])) as Partial<AgentShareInput>;
          const { resource, paths } = maskedEdit(current, buildAgentShareProto, patch);
          return await stigmer.agentShare.update(resource, paths);
        }
        return await stigmer.agentShare.apply({
          // Identity: the agent's org + the caller-chosen identity,
          // falling back to the agent's own slug/name (the server's
          // default, made explicit).
          org: agentOrg,
          slug: createIdentity?.slug || agentSlug,
          name: createIdentity?.name || agentName || agentSlug,
          agentRef: { org: agentOrg, slug: agentSlug },
          ...shareSettingsOf(draft),
        });
      } catch (err) {
        setError(toError(err));
        throw err;
      } finally {
        setIsPending(false);
      }
    },
    [agentOrg, agentSlug, agentName, stigmer],
  );

  return { save, isPending, error };
}

/** A draft as the SDK input's spec fields, keyed by the draft's own names. */
function shareSettingsOf(draft: AgentShareDraft): Pick<
  AgentShareInput,
  "enabled" | "audience" | "allowedOrigins" | "messages" | "vaults" | "runConfig"
> {
  return {
    enabled: draft.enabled,
    // Written as the explicit enum value, never left unspecified — a share
    // persisted as "public" can't be silently downgraded by tooling that
    // relies on the unspecified-means-public rule.
    audience: sharingAudienceToProto(draft.audience),
    allowedOrigins: [...draft.allowedOrigins],
    messages: {
      rateLimited: draft.messages.rateLimited,
      unavailable: draft.messages.unavailable,
      conversationEnded: draft.messages.conversationEnded,
    },
    vaults: draft.vaults.map((ref) => ({ org: ref.org, slug: ref.slug })),
    runConfig: draft.runConfig,
  };
}
