import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";

/**
 * Metadata labels the cloud channel runtime stamps on every session it
 * creates (one per external conversation). Mirrors
 * `ChannelRuntimeConstants` in the Stigmer Cloud backend — the single
 * continuity/audit key set for channel conversations. Console-created
 * sessions never carry any of them.
 */
export const CHANNEL_SESSION_LABELS = {
  /** The AgentChannel that originated the conversation. */
  channelId: "stigmer.ai/channel-id",
  /** The external platform user (e.g. Slack user id, WhatsApp wa_id). */
  externalUserKey: "stigmer.ai/channel-external-user-key",
  /** The provider-side conversation identity (thread ts, wa_id, ...). */
  conversationKey: "stigmer.ai/channel-conversation-key",
} as const;

/**
 * Whether a session was created by the channel runtime (a Slack/WhatsApp
 * conversation) rather than by a person in the console.
 *
 * Channel viewers hold read-only access (`can_view` without
 * `can_create_execution_in`), so session organisms use this to
 * self-select the `"observer"` audience — every entry point renders
 * read-only without host wiring.
 */
export function isChannelOriginSession(
  session: Session | null | undefined,
): boolean {
  return Boolean(
    session?.metadata?.labels?.[CHANNEL_SESSION_LABELS.channelId],
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
