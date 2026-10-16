import type { Session } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";

/**
 * Metadata labels the channel runtime stamps on the sessions a channel
 * serves. Console-created sessions carry none of them.
 *
 * Each label answers one question:
 *
 * - `channelId` says which channel served this session. Every session a
 *   channel serves carries it: a guest's chat-link session as much as a
 *   Slack or WhatsApp conversation.
 * - `conversationKey` says this session continues a Slack or WhatsApp
 *   conversation. Only those carry it; a chat-link session never does.
 * - `externalUserKey` names the person on the external platform.
 */
export const CHANNEL_SESSION_LABELS = {
  /** The Channel that served the session (any type). */
  channelId: "stigmer.ai/channel-id",
  /** The external platform user (e.g. Slack user id, WhatsApp wa_id). */
  externalUserKey: "stigmer.ai/channel-external-user-key",
  /** The provider-side conversation identity (thread ts, wa_id, ...); Slack and WhatsApp only. */
  conversationKey: "stigmer.ai/channel-conversation-key",
} as const;

/**
 * Whether a session continues a Slack or WhatsApp conversation rather than
 * a chat a person holds in the console or over a chat link.
 *
 * Asked of the conversation key, never the channel id: a guest's chat-link
 * session carries the channel id too, and the guest is the session's
 * owner, who must keep the composer and auto-approval.
 *
 * Channel viewers hold read-only access (`can_view` without
 * `can_create_run_in`, which a session grants only its owners and
 * participants), so session organisms use this to
 * self-select the `"observer"` audience — every entry point renders
 * read-only without host wiring.
 */
export function isChannelOriginSession(
  session: Session | null | undefined,
): boolean {
  return Boolean(
    session?.metadata?.labels?.[CHANNEL_SESSION_LABELS.conversationKey],
  );
}

/**
 * The external platform user a channel session belongs to, or `undefined`
 * for non-channel sessions. An opaque provider id (e.g. `U0AB12CD3`) in
 * v1 — display-name resolution is a future enhancement.
 */
export function channelSessionExternalUserKey(
  session: Session | null | undefined,
): string | undefined {
  return session?.metadata?.labels?.[CHANNEL_SESSION_LABELS.externalUserKey];
}
