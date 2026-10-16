/**
 * The chat-link dialog's draft of a web channel (an agent's hosted chat link
 * and website widget), and the SDK inputs a save sends: a create of a new
 * web channel ({@link webChannelCreateInput}, through `useCreateChannel`)
 * or an edit of one as loaded ({@link webChannelPatch}, through
 * `useSaveChannel().update`). Framework-free: no hook lives here.
 */

import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { Channel } from "@stigmer/protos/ai/stigmer/agentic/channel/v1/api_pb";
import {
  ChannelAudience,
  type WebChannelConfig,
} from "@stigmer/protos/ai/stigmer/agentic/channel/v1/spec_pb";
import type {
  ChannelInput,
  ResourceRef,
  RunConfigInput,
  WebChannelConfigInput,
} from "@stigmer/sdk";

/**
 * Who can chat with an agent over its hosted chat link.
 *
 * - `"public"` — anyone with the link; visitors are anonymous guests.
 * - `"org"` — signed-in members of the owning organization only.
 *   Membership is checked on every conversation turn, so access ends the
 *   moment a member leaves the org.
 */
export type ChatLinkAudience = "public" | "org";

/**
 * A complete web channel configuration, as the chat-link dialog edits it.
 *
 * Every field is required so a create carries a whole configuration. An
 * edit of an existing channel names only the fields it saves (all of them
 * by default, or the ones the caller passes to {@link webChannelPatch}),
 * on the channel as loaded with the etag it was read at, so a field it
 * does not name keeps its stored value. (The rotatable link token is
 * server-owned `status`, which no save touches.)
 */
export interface WebChannelDraft {
  /** Whether hosted-chat access for the configured audience is enabled. */
  readonly enabled: boolean;
  /** Who can chat: anyone with the link, or org members only. */
  readonly audience: ChatLinkAudience;
  /**
   * Exact web origins allowed to embed the agent's chat
   * (e.g. `https://example.com`). Empty list = embeddable anywhere.
   * Embedding is public-audience only.
   */
  readonly allowedOrigins: readonly string[];
  /** Owner-customized visitor refusal copy. Empty strings mean platform defaults. */
  readonly messages: {
    /** Shown when a visitor exceeds the message rate limit. */
    readonly rateLimited: string;
    /** Shown when the channel cannot serve the conversation, e.g. the org holds no provider key for the agent's model (fails closed). */
    readonly unavailable: string;
    /** Shown when a conversation hits its turn limit or inactivity timeout. */
    readonly conversationEnded: string;
  };
  /**
   * Shared vaults whose keys guest conversations use, in order —
   * how a tool-using agent becomes chattable over a chat link without
   * touching the agent itself. Public-audience only (the proto CEL rule
   * rejects bindings on an org-audience web channel).
   */
  readonly vaults: readonly ResourceRef[];
  /**
   * The owner's per-channel run override (model / cost cap / tool
   * rounds / service tier), merged over the platform guest profile at
   * run time — stigmer/stigmer#360. The console does not edit it (yet):
   * it is saved back as loaded with the rest of the dialog's fields.
   * Public-audience only (the same proto CEL rule as vaults, for the
   * same reason).
   */
  readonly runConfig: RunConfigInput | undefined;
}

/**
 * Maps a proto {@link ChannelAudience} to the SDK's string union.
 * Only an explicit public audience is "public": unspecified means the
 * organization's members by contract, so a chat link reaches the internet
 * only when someone chose "Anyone with the link".
 */
export function chatLinkAudienceFromProto(
  audience: ChannelAudience | undefined,
): ChatLinkAudience {
  return audience === ChannelAudience.public ? "public" : "org";
}

function chatLinkAudienceToProto(audience: ChatLinkAudience): ChannelAudience {
  return audience === "org" ? ChannelAudience.org : ChannelAudience.public;
}

/** The web arm of a channel's `spec.type`, or `undefined` for any other type. */
export function webConfigOf(channel: Channel | null | undefined): WebChannelConfig | undefined {
  const type = channel?.spec?.type;
  return type?.case === "web" ? type.value : undefined;
}

/**
 * The rotatable token that locks a web channel's chat link (the web arm
 * of `status.typeStatus`), or `""` when the link is plain or the channel
 * is another type. Server-owned: `rotateLink` is its sole writer.
 */
export function webLinkTokenOf(channel: Channel | null | undefined): string {
  const typeStatus = channel?.status?.typeStatus;
  return typeStatus?.case === "web" ? typeStatus.value.linkToken : "";
}

/**
 * Projects a web channel into the editable {@link WebChannelDraft} — the
 * single constructor for the full-spec drafts every save requires.
 * `null` (no channel yet) seeds the same defaults the server would apply
 * on first create.
 *
 * Shared by the chat-link dialog (draft seeding) and the chat-link card.
 */
export function draftFromWebChannel(channel: Channel | null): WebChannelDraft {
  const spec = channel?.spec;
  const web = webConfigOf(channel);
  return {
    enabled: spec?.enabled ?? false,
    audience: chatLinkAudienceFromProto(web?.audience),
    allowedOrigins: web?.allowedOrigins ?? [],
    messages: {
      rateLimited: web?.messages?.rateLimited ?? "",
      unavailable: web?.messages?.unavailable ?? "",
      conversationEnded: web?.messages?.conversationEnded ?? "",
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
 * Identity for a web channel being created: its display name and its
 * slug in the agent organization's namespace, which every channel type
 * shares. An existing channel's identity is not the dialog's to change.
 */
export interface WebChannelCreateIdentity {
  /** Display name for the new channel. */
  readonly name: string;
  /**
   * Slug for the new channel: its name in its organization, as the CLI
   * and API address it. The hosted chat link names the channel by its id.
   */
  readonly slug: string;
}

/**
 * The SDK input that creates `agent`'s web channel from a draft. The
 * channel lives in the agent's own organization: its URL, billing and
 * credential bindings all belong to the organization that owns the agent,
 * and the server refuses an `agent_ref` in any other. To give people a chat
 * link to another organization's agent, install the plugin that carries
 * it and make the link on the installed copy.
 *
 * Without an identity the server names the channel: slug
 * `<agent slug>-web`, name `<agent name> (Web)`.
 *
 * @example
 * ```tsx
 * const { createChannel } = useCreateChannel();
 * const created = await createChannel(
 *   webChannelCreateInput(agent, { ...draftFromWebChannel(null), enabled: true }, { name, slug }),
 * );
 * ```
 */
export function webChannelCreateInput(
  agent: Agent,
  draft: WebChannelDraft,
  identity?: WebChannelCreateIdentity,
): ChannelInput {
  const org = agent.metadata?.org ?? "";
  return {
    org,
    name: identity?.name ?? "",
    ...(identity?.slug ? { slug: identity.slug } : {}),
    agentRef: { org, slug: agent.metadata?.slug ?? "" },
    enabled: draft.enabled,
    web: webSettingsOf(draft),
    vaults: draft.vaults.map((ref) => ({ org: ref.org, slug: ref.slug })),
    runConfig: draft.runConfig,
  };
}

/**
 * The edit a draft makes to a web channel, for `useSaveChannel().update`:
 * the fields named (every draft field when `fields` is omitted) and no
 * other, so a teammate's change to another field stays. The web settings
 * are named one by one (`spec.web.audience`, `spec.web.allowed_origins`,
 * `spec.web.messages`), never the web arm whole.
 *
 * @example
 * ```tsx
 * const { update } = useSaveChannel();
 * const persisted = await update(channel, webChannelPatch(draft));
 * // the web arm of persisted.status.typeStatus carries the live link token
 * ```
 */
export function webChannelPatch(
  draft: WebChannelDraft,
  fields?: ReadonlyArray<keyof WebChannelDraft>,
): Partial<ChannelInput> {
  const named = new Set<keyof WebChannelDraft>(
    fields ?? ["enabled", "audience", "allowedOrigins", "messages", "vaults", "runConfig"],
  );
  const settings = webSettingsOf(draft);
  const web: WebChannelConfigInput = {
    ...(named.has("audience") && { audience: settings.audience }),
    ...(named.has("allowedOrigins") && { allowedOrigins: settings.allowedOrigins }),
    ...(named.has("messages") && { messages: settings.messages }),
  };
  return {
    ...(named.has("enabled") && { enabled: draft.enabled }),
    ...(Object.keys(web).length > 0 && { web }),
    ...(named.has("vaults") && {
      vaults: draft.vaults.map((ref) => ({ org: ref.org, slug: ref.slug })),
    }),
    ...(named.has("runConfig") && { runConfig: draft.runConfig }),
  };
}

/** A draft's web settings as the SDK input's web arm. */
function webSettingsOf(draft: WebChannelDraft): Required<WebChannelConfigInput> {
  return {
    // Written as the explicit enum value, never left unspecified — a
    // channel persisted as "public" can't be silently downgraded by
    // tooling that relies on the unspecified-means-org rule.
    audience: chatLinkAudienceToProto(draft.audience),
    allowedOrigins: [...draft.allowedOrigins],
    messages: {
      rateLimited: draft.messages.rateLimited,
      unavailable: draft.messages.unavailable,
      conversationEnded: draft.messages.conversationEnded,
    },
  };
}
