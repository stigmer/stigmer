/**
 * Pure helpers for the "bring your own Meta app" setup surface (T05).
 *
 * A customer-owned Meta app needs two Stigmer-side values wired into its
 * WhatsApp webhook configuration on developers.facebook.com: the app's
 * own events webhook URL (per-app by design: the path is how the
 * receiver knows which app secret verifies the request) and the verify
 * token Meta echoes during the GET verification handshake.
 *
 * Unlike Slack there is no app manifest to paste — Meta's dashboard has
 * no equivalent — so the setup surface renders a checklist instead. And
 * unlike Slack's install-minted bot token, every WhatsApp credential is
 * authored by the customer on their own Meta app (DD-WA-3), including
 * the verify token: Stigmer generates a strong one at registration as a
 * convenience, and it must be pasted into Meta verbatim.
 *
 * Setup is inherently two-phase, same shape as Slack: the webhook URL
 * embeds the ChannelApp id, which only exists after registration:
 *
 *  1. Gather the Meta app's credentials (app ID, app secret, a
 *     long-lived access token) and register them with a verify token in
 *     `CreateChannelAppForm`.
 *  2. The saved ChannelApp has an id, so `ChannelAppDetailPanel` can
 *     show the webhook URL — paste it and the verify token into the
 *     app's WhatsApp webhook configuration.
 */

/**
 * The webhook fields every Stigmer WhatsApp channel app subscribes to —
 * inbound messages only (field minimalism is deliberate; the adapter
 * replies to inbound messages and needs nothing else).
 */
export const WHATSAPP_CHANNEL_APP_WEBHOOK_FIELDS = ["messages"] as const;

/**
 * The events webhook URL for one ChannelApp: the per-app route the
 * receiver resolves the app's secret and verify token by.
 *
 * @param apiBaseUrl the Stigmer API origin (`stigmer.baseUrl`)
 * @param channelAppId the ChannelApp resource id (`chapp_...`)
 */
export function whatsappChannelAppWebhookUrl(
  apiBaseUrl: string,
  channelAppId: string,
): string {
  return `${apiBaseUrl.replace(/\/+$/, "")}/webhook/whatsapp/${channelAppId}`;
}

/**
 * Generate a verify token for a new WhatsApp channel app: 32 bytes of
 * CSPRNG randomness as lowercase hex (64 chars, paste-safe — no
 * URL-hostile characters for Meta's form).
 *
 * The token is a shared secret in the weakest sense — Meta echoes it on
 * the one-time GET handshake — but a guessable one would let a stranger
 * "verify" a webhook they control, so it gets real entropy anyway.
 */
export function generateWhatsAppVerifyToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
